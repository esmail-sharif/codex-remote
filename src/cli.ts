import { parseArgs, stripVTControlCharacters } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteService, type Status } from './service.js';
import { RemoteError, errorResult } from './errors.js';
import { pairingTerminal } from './pairing.js';
import { showPairing } from './terminal.js';
import { serve } from './mcp.js';
import { version } from './version.js';
import { registerTerminal, terminalHost } from './terminal-host.js';

const execute = promisify(execFile);
const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const adminEnabled = () => process.env.CODEX_REMOTE_ENABLE_ADMIN_TOOLS === '1';
const terminalEnabled = () => process.env.CODEX_REMOTE_ENABLE_TERMINAL_EXTENSIONS === '1';

function helpText() {
  const lines = [
    `Codex Remote ${version} — restricted phone pairing for terminal Codex`,
    '',
    'codex-remote status [--json]  Read relay status without changing it',
    'codex-remote qr [--json]     Create a phone pairing QR (enables persistent access)',
    'codex-remote pair [--json]   Alias for qr',
    'codex-remote install         Install the local Codex plugin',
    'codex-remote serve           Run the restricted MCP server over stdio',
  ];
  if (adminEnabled()) lines.push('', 'ADMIN TOOLS ENABLED (explicit opt-in):', 'codex-remote enable [--json]', 'codex-remote disable [--json]', 'codex-remote devices list [--json]', 'codex-remote devices revoke DEVICE_ID [--json]');
  if (terminalEnabled()) lines.push('', 'TERMINAL EXTENSIONS ENABLED (explicit opt-in):', 'codex-remote terminal enable', 'codex-remote terminal disable', 'codex-remote terminal status');
  lines.push('', 'QR pairing enables persistent native remote access until an operator disables it locally.', 'Admin tools and terminal extensions are disabled by default.', 'CODEX_HOME selects the native Codex home; CODEX_REMOTE_CODEX_BIN selects the Codex executable.');
  return lines.join('\n');
}

function printStatus(status: Status) {
  console.log(clean(`Remote access: ${status.status}${status.serverName ? ` on ${status.serverName}` : ''}`));
  if (status.diagnostic) console.log(clean(status.diagnostic));
}

async function run() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    json: { type: 'boolean' }, interactive: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  } });
  const [command = 'help', subcommand, id, ...extra] = positionals;
  if (values.version) { console.log(version); return; }
  if (values.help || command === 'help') { console.log(helpText()); return; }
  const json = !!values.json;
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (values.interactive && (json || !['qr', 'pair'].includes(command) || !process.stdin.isTTY)) throw new RemoteError('invalid_arguments', '--interactive requires a terminal and a human pairing display.');
  if (extra.length || (!['devices', 'terminal'].includes(command) && subcommand !== undefined)) throw new RemoteError('invalid_arguments', 'Unexpected arguments. Run codex-remote --help.');

  if (command === 'terminal') {
    if (!terminalEnabled()) throw new RemoteError('feature_disabled', 'Terminal Extensions are disabled by default. Set CODEX_REMOTE_ENABLE_TERMINAL_EXTENSIONS=1 explicitly to enable them.');
    if (id || !['enable', 'disable', 'status'].includes(subcommand || '')) throw new RemoteError('invalid_arguments', 'Use terminal enable, disable, or status.');
    if (subcommand === 'enable') { await registerTerminal(); print(await terminalHost(['enable'])); }
    else print(await terminalHost(subcommand === 'disable' ? ['unregister', 'codex-remote'] : ['status', '--json']));
    return;
  }
  if (command === 'serve') { await serve(); return; }
  if (command === 'install') {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const native = process.env.CODEX_REMOTE_CODEX_BIN || 'codex';
    await execute(native, ['plugin', 'marketplace', 'add', root, '--json'], { env: process.env, timeout: 45000 });
    const installed = await execute(native, ['plugin', 'add', 'codex-remote@codex-remote-local', '--json'], { env: process.env, timeout: 45000 });
    const terminal = terminalEnabled() ? await registerTerminal(true) : { available: false, registered: false, disabledByDefault: true };
    const output = { installed: true, result: JSON.parse(installed.stdout), terminal, next: 'Start a new Codex terminal to load the restricted plugin. Ask for a QR only when you intend to enable persistent remote access. Admin tools and terminal extensions are disabled by default.' };
    if (json) print(output); else console.log(output.next);
    return;
  }

  const service = new RemoteService();
  if (['status', 'enable', 'disable'].includes(command)) {
    if (command !== 'status' && !adminEnabled()) throw new RemoteError('feature_disabled', 'Administrative commands are disabled. Set CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1 explicitly in a local operator shell to enable them.');
    const status = await service[command as 'status' | 'enable' | 'disable']();
    if (json) print(status); else printStatus(status);
  } else if (['qr', 'pair'].includes(command)) {
    const pair = await service.qr();
    if (json) print(pair);
    else if (values.interactive) await showPairing(pair);
    else {
      console.log('Scan to pair this host with ChatGPT on Android or iPhone.\n');
      console.log(await pairingTerminal(pair));
      console.log(pair.pairingUrl);
      if (pair.manualPairingCode) console.log(clean(`Manual code: ${pair.manualPairingCode}`));
      console.log(`Expires: ${pair.expiresAtIso}\nRemote access remains enabled until an operator disables it locally.`);
    }
  } else if (command === 'devices' && adminEnabled() && subcommand === 'list' && !id) {
    const result = await service.devices();
    if (json) print(result);
    else if (!result.devices.length) console.log('No paired devices.');
    else for (const device of result.devices) console.log(clean(`${device.clientId}  ${device.displayName || device.deviceModel || 'Unnamed device'}  ${device.platform || device.deviceType || ''}`));
  } else if (command === 'devices' && adminEnabled() && subcommand === 'revoke' && id) {
    const result = await service.revoke(id); if (json) print(result); else console.log(clean(`Revoked device ${result.clientId}. Local sessions are still running.`));
  } else if (command === 'devices' && !adminEnabled()) {
    throw new RemoteError('feature_disabled', 'Device administration is disabled. Set CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1 explicitly in a local operator shell to enable it.');
  } else throw new RemoteError('invalid_arguments', 'Unknown command or missing argument. Run codex-remote --help.');
}

try { await run(); }
catch (error) {
  const result = errorResult(error);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ error: result }));
  else process.stderr.write(`Codex Remote: ${clean(result.message)}\n`);
  process.exitCode = 1;
} finally {
  if (process.exitCode === 1 && process.argv.includes('--interactive') && !process.argv.includes('--json') && process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { await prompt.question('\nPress Enter to return to your Codex chat. '); } finally { prompt.close(); }
  }
}
