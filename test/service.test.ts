import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, device } from './fixture.js';
import { parseDaemonOutput } from '../src/native.js';
import { SocketRpc } from '../src/rpc.js';

test('default status reads relay state only and never changes or enumerates the host', async t => {
  const { service, state } = await fixture(t); state.devices = [];
  const status = await service.status();
  assert.equal(status.status, 'connected'); assert.equal(status.pairing, 'unknown'); assert.equal(status.pairedDevices, null);
  assert.deepEqual(state.commands, [['app-server', 'daemon', 'version']]);
  assert.equal(state.calls.some(c => c.method === 'remoteControl/enable'), false);
  assert.equal(state.calls.some(c => c.method === 'remoteControl/client/list'), false, 'status does not enumerate device records');\n  assert.equal('environmentId' in status, false); assert.equal('installationId' in status, false);
});
test('enable and disable persist through socket RPCs without daemon lifecycle changes', async t => {
  const { service, state } = await fixture(t, 'disabled');
  assert.equal((await service.enable()).status, 'connected'); assert.equal(state.persisted, true);
  assert.equal((await service.disable()).status, 'disabled'); assert.equal(state.persisted, false);
  assert.deepEqual(state.calls.filter(c => ['remoteControl/enable', 'remoteControl/disable'].includes(c.method)).map(c => c.params), [{ ephemeral: false }, { ephemeral: false }]);
  assert.ok(state.commands.every(c => c.join(' ') === 'app-server daemon version'));
  assert.equal(state.devices.length, 1, 'disabling preserves pairings');
});
test('read-only status does not start a stopped daemon, explicit enable starts exactly once', async t => {
  const { service, state } = await fixture(t, 'disabled'); state.running = false;
  assert.equal((await service.status()).daemon, 'stopped'); assert.equal(state.calls.length, 0);
  await service.enable(); await service.enable();
  assert.equal(state.commands.filter(c => c.at(-1) === 'start').length, 1);
  assert.ok(state.commands.every(c => ['app-server daemon start', 'app-server daemon version'].includes(c.join(' '))));
});
test('disable with no running server does not pretend to clear a persisted preference', async t => {
  const { service, state } = await fixture(t); state.running = false;
  await assert.rejects(service.disable(), { code: 'daemon_unavailable' }); assert.equal(state.calls.length, 0);
});
test('pairing uses native QR token, encodes it correctly, and keeps existing devices', async t => {
  const { service, state } = await fixture(t);
  const pair = await service.qr();
  assert.equal(new URL(pair.pairingUrl).searchParams.get('pairing_code'), state.pairingCode);
  assert.equal(new URL(pair.pairingUrl).pathname, '/codex/pair');
  assert.equal(Date.parse(pair.expiresAtIso), state.expiresAt * 1000);
  assert.equal(state.calls.filter(c => c.method === 'remoteControl/pairing/start').length, 1);
  assert.equal(state.calls.some(c => c.method === 'remoteControl/enable'), false);
  assert.equal(state.devices.length, 1);
});
test('QR request enables a disabled host in place before pairing', async t => {
  const { service, state } = await fixture(t, 'disabled'); await service.qr();
  const methods = state.calls.map(c => c.method);
  assert.ok(methods.indexOf('remoteControl/enable') < methods.indexOf('remoteControl/pairing/start'));
  assert.equal(state.persisted, true); assert.equal(state.commands.some(c => c.at(-1) === 'start'), false);
});
test('expired pairing is rejected without an automatic second code', async t => {
  const { service, state } = await fixture(t); state.expiresAt = Math.floor(Date.now() / 1000) - 1;
  await assert.rejects(service.pair(), { code: 'pairing_expired' });
  assert.equal(state.calls.filter(c => c.method === 'remoteControl/pairing/start').length, 1);
});
test('device listing follows native pagination and rejects cursor loops', async t => {
  const { service, state } = await fixture(t); state.devices = [device('one'), device('two'), device('three')]; state.pageSize = 1;
  assert.deepEqual((await service.devices()).devices.map(d => d.clientId), ['one', 'two', 'three']);
  state.repeatCursor = true;
  await assert.rejects(service.devices(), { code: 'protocol_error' });
});
test('revocation targets an exact device and current host environment', async t => {
  const { service, state } = await fixture(t);
  await assert.rejects(service.revoke('missing'), { code: 'device_not_found' });
  assert.equal(state.calls.some(c => c.method === 'remoteControl/client/revoke'), false);
  assert.equal((await service.revoke('phone-one')).revoked, true);
  assert.deepEqual(state.calls.find(c => c.method === 'remoteControl/client/revoke')?.params, { environmentId: 'env-test', clientId: 'phone-one' });
  assert.equal(state.devices.length, 0); assert.equal(state.remote.status, 'connected');
});
test('disabled hosts are not reported as having lost their paired devices', async t => {
  const { service } = await fixture(t, 'disabled');
  assert.equal((await service.status()).pairing, 'unknown');
  await assert.rejects(service.devices(), { code: 'remote_not_ready' });
});
test('native auth and policy errors propagate without retries or lifecycle fallback', async t => {
  const { service, state } = await fixture(t, 'disabled');
  state.errors.set('remoteControl/enable', { code: -32000, message: 'Remote control requires ChatGPT authentication' });
  await assert.rejects(service.enable(), /ChatGPT authentication/);
  assert.equal(state.calls.filter(c => c.method === 'remoteControl/enable').length, 1);
  assert.ok(state.commands.every(c => c.at(-1) === 'version'));
});
test('unsupported methods, malformed messages, incompatible results, disconnects and timeouts fail clearly', async t => {
  for (const [kind, code] of [['unsupported', 'unsupported_codex'], ['malformed', 'protocol_error'], ['invalid', 'protocol_error'], ['drop', 'disconnected'], ['hang', 'timeout']] as const) {
    await t.test(kind, async t => {
      const { service, state } = await fixture(t);
      if (kind === 'unsupported') state.errors.set('remoteControl/status/read', { code: -32601, message: 'Unknown method' });
      else state[kind] = 'remoteControl/status/read';
      await assert.rejects(service.status(), { code });
      assert.ok(state.commands.every(c => c.at(-1) === 'version'));
    });
  }
});
test('default relay status does not request paired-device inventory', async t => {
  const { service, state } = await fixture(t);
  state.errors.set('remoteControl/client/list', { code: -32000, message: 'Policy disallows device listing' });
  const status = await service.status();
  assert.equal(status.status, 'connected'); assert.equal(status.pairing, 'unknown'); assert.equal(status.pairedDevices, null);
  assert.equal(state.calls.some(c => c.method === 'remoteControl/client/list'), false);
});
test('daemon output tolerates native diagnostic lines and rejects incompatible interfaces', () => {
  assert.equal(parseDaemonOutput('noise\n{"status":"running","socketPath":"/tmp/native.sock"}\n').status, 'running');
  assert.throws(() => parseDaemonOutput('{"status":"running","socketPath":"ws://external"}'), { code: 'unsupported_codex' });
});
test('socket client never opens a network endpoint', async () => {
  await assert.rejects(SocketRpc.connect('wss://outside.example'), { code: 'invalid_socket' });
});
