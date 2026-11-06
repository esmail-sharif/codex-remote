import test from 'node:test';
import { version } from '../src/version.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PNG } from 'pngjs';
import { createRequire } from 'node:module';
import type { QRCode } from 'jsqr';
import { fixture } from './fixture.js';
import { createMcpServer } from '../src/mcp.js';
import { pairingPng, pairingTerminal, pairingText } from '../src/pairing.js';
import { mkdir, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const execute = promisify(execFile);
const jsQR = createRequire(import.meta.url)('jsqr') as (pixels: Uint8ClampedArray, width: number, height: number) => QRCode | null;
test('pairing PNG decodes to the exact native pairing URL', async t => {
  const { service } = await fixture(t); const pair = await service.pair();
  const png = PNG.sync.read(await pairingPng(pair));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded?.data, pair.pairingUrl);
  const terminal = await pairingTerminal(pair); assert.match(terminal, /\u001b\[/); assert.ok(terminal.split('\n').length > 10);
  const lines = pairingText(pair).split('\n'), scale = 8, width = lines[0].length * scale, height = lines.length * 2 * scale;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const character = lines[Math.floor(y / (scale * 2))][Math.floor(x / scale)];
    const top = Math.floor(y / scale) % 2 === 0;
    if (character === '█' || character === (top ? '▀' : '▄')) for (let c = 0; c < 3; c++) pixels[(y * width + x) * 4 + c] = 0;
  }
  assert.equal(jsQR(pixels, width, height)?.data, pair.pairingUrl, 'conversation text QR decodes independently');
});
test('default MCP exposes only status and explicit QR pairing', async t => {
  const { service, state } = await fixture(t); const server = createMcpServer(service);
  const client = new Client({ name: 'test', version: '1' }); const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b); t.after(async () => { await client.close(); await server.close(); });
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['remote_pair', 'remote_status']);
  assert.equal(tools.find(tool => tool.name === 'remote_status')?.annotations?.readOnlyHint, true);
  assert.equal(tools.some(tool => tool.name.includes('revoke') || tool.name.includes('disable') || tool.name.includes('devices')), false);
  const response = await client.callTool({ name: 'remote_pair', arguments: {} });
  const content = response.content as Array<{ type: string; data?: string; text?: string }>;
  assert.equal(content[1].type, 'image');
  const png = PNG.sync.read(Buffer.from(content[1].data!, 'base64'));
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, JSON.parse(content[0].text!).pairingUrl);
  state.errors.set('remoteControl/status/read', { code: -32000, message: 'Blocked by workspace policy' });
  assert.equal((await client.callTool({ name: 'remote_status', arguments: {} })).isError, true);
});
test('administrative MCP tools appear only after explicit opt-in', async t => {
  const { service } = await fixture(t); const server = createMcpServer(service, { adminTools: true });
  const client = new Client({ name: 'admin-test', version: '1' }); const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b); t.after(async () => { await client.close(); await server.close(); });
  const names = (await client.listTools()).tools.map(tool => tool.name).sort();
  assert.deepEqual(names, ['remote_device_revoke', 'remote_devices_list', 'remote_disable', 'remote_enable', 'remote_pair', 'remote_status']);
});
test('built CLI emits clean machine-readable status, pairing and validation errors', async t => {
  const { nativeStub } = await fixture(t); const env = { ...process.env, CODEX_REMOTE_CODEX_BIN: nativeStub };
  const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) => execute(process.execPath, ['dist/cli.js', ...args], { env: { ...env, ...extraEnv } });
  const status = JSON.parse((await run(['status', '--json'])).stdout); assert.equal(status.pairing, 'unknown'); assert.equal(status.pairedDevices, null);
  const pair = JSON.parse((await run(['qr', '--json'])).stdout); assert.equal(new URL(pair.pairingUrl).hostname, 'chatgpt.com');
  assert.equal((await run(['--version'])).stdout.trim(), version);
  const help = (await run(['--help'])).stdout;
  assert.match(help, /remote_pair/); assert.doesNotMatch(help, /remote_enable|remote_disable|devices revoke|terminal enable/);
  await assert.rejects(run(['disable', '--json']), (error: any) => JSON.parse(error.stdout).error.code === 'feature_disabled');
  await assert.rejects(run(['terminal', 'enable', '--json']), (error: any) => JSON.parse(error.stdout).error.code === 'feature_disabled');
  assert.match((await run(['--help'], { CODEX_REMOTE_ENABLE_ADMIN_TOOLS: '1' })).stdout, /codex-remote disable/);
  await assert.rejects(run(['devices', 'revoke', '--json']), (error: any) => { assert.equal(error.code, 1); assert.equal(JSON.parse(error.stdout).error.code, 'invalid_arguments'); return true; });
  await assert.rejects(run(['qr', 'unexpected', '--json']), (error: any) => { assert.equal(JSON.parse(error.stdout).error.code, 'invalid_arguments'); return true; });
});
test('packaged stdio MCP is callable without stdout diagnostics contaminating the protocol', async t => {
  const { nativeStub } = await fixture(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/cli.js', 'serve'], env: { PATH: process.env.PATH || '', CODEX_REMOTE_CODEX_BIN: nativeStub }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-test', version: '1' });
  await client.connect(transport); t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['remote_pair', 'remote_status']);
  const result = await client.callTool({ name: 'remote_status', arguments: {} });
  assert.equal(result.isError, undefined); assert.match(JSON.stringify(result.structuredContent), /connected/);
});
test('/qr opens a scannable terminal view and returns to the retained chat', async t => {
  const { nativeStub, root, state } = await fixture(t);
  const host = resolve(process.env.CODEX_TERMINAL_TEST_ROOT || '../codex-terminal-extensions');
  if (!existsSync(join(host, 'dist/cli.js'))) { t.skip('Shared terminal host checkout is not available'); return; }
  await mkdir(join(root, 'bin'));
  await symlink(resolve('dist/cli.js'), join(root, 'bin/codex-remote'));
  const env = { ...process.env, CODEX_REMOTE_CODEX_BIN: nativeStub, PATH: `${join(root, 'bin')}:${process.env.PATH}`, CODEX_TERMINAL_DATA_DIR: join(root, 'folders') };
  const output = await execute('python3', ['test/qr_pty.py', host], { env, timeout: 60000 });
  assert.match(output.stdout, /retained chat/);
  assert.equal(state.calls.filter(c => c.method === 'remoteControl/pairing/start').length, 1);
  assert.equal(state.calls.some(c => /enable|disable|revoke/.test(c.method)), false);
});
