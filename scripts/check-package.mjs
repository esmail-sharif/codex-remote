// Exercise the distributable, not a source checkout or an existing global install.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'codex-remote-package-'));
const source = JSON.parse(await readFile('package.json', 'utf8'));
const client = new Client({ name: 'release-smoke', version: '1' });
let connected = false;
try {
  const packed = JSON.parse((await execute('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root])).stdout);
  const pack = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  const required = ['dist/cli.js', 'terminal-extension.json', '.agents/plugins/marketplace.json', 'plugins/codex-remote/.codex-plugin/plugin.json', 'plugins/codex-remote/.mcp.json', 'plugins/codex-remote/skills/remote-pairing/SKILL.md'];
  for (const path of required) assert.ok(pack.files.some(file => file.path === path), `Missing ${path}`);
  for (const file of pack.files) assert.ok(!/^(src|test|validation|node_modules|\.github)\//.test(file.path), `Unexpected ${file.path}`);
  const prefix = join(root, 'prefix');
  await execute('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', join(root, pack.filename)], { timeout: 180000 });
  const binary = join(prefix, 'bin/codex-remote');
  assert.equal((await execute(binary, ['--version'])).stdout.trim(), source.version);
  assert.match((await execute(binary, ['--help'])).stdout, /restricted phone pairing/);
  assert.doesNotMatch((await execute(binary, ['--help'])).stdout, /remote_enable|remote_disable|devices revoke|terminal enable/);
  const installed = join(prefix, 'lib/node_modules/codex-remote');
  const manifest = JSON.parse(await readFile(join(installed, 'plugins/codex-remote/.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.version, source.version);
  const native = join(root, 'codex-stub');
  const calls = join(root, 'calls.jsonl');
  await writeFile(native, `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');\nconsole.log(JSON.stringify({installed:true}));\n`);
  await chmod(native, 0o755);
  const home = join(root, 'codex-home');
  await mkdir(home);
  const env = { ...process.env, CODEX_HOME: home, CODEX_REMOTE_CODEX_BIN: native };
  const result = JSON.parse((await execute(binary, ['install', '--json'], { env })).stdout);
  assert.equal(result.installed, true);
  const commands = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(commands, [
    ['plugin', 'marketplace', 'add', installed, '--json'],
    ['plugin', 'add', 'codex-remote@codex-remote-local', '--json'],
  ]);
  // Merely listing MCP tools does not connect to the user's daemon or enable access.
  await client.connect(new StdioClientTransport({ command: binary, args: ['serve'], env: { PATH: process.env.PATH || '', CODEX_HOME: home }, stderr: 'pipe' }));
  connected = true;
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['remote_pair', 'remote_status']);
  console.log(`Package smoke passed: ${source.name}@${source.version}; clean install, plugin registration arguments, hidden manifests, two default MCP tools.`);
} finally {
  if (connected) await client.close();
  await rm(root, { recursive: true, force: true });
}
