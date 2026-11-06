import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { CodexHost, type DaemonInfo, type NativeHost } from './native.js';
import { SocketRpc, type Rpc } from './rpc.js';
import { RemoteError } from './errors.js';

const remoteSchema = z.object({ status: z.enum(['disabled', 'connecting', 'connected', 'errored']), serverName: z.string(), installationId: z.string(), environmentId: z.string().nullable() });
const deviceSchema = z.object({
  clientId: z.string(), displayName: z.string().nullable(), deviceType: z.string().nullable(), platform: z.string().nullable(),
  osVersion: z.string().nullable(), deviceModel: z.string().nullable(), appVersion: z.string().nullable(), lastSeenAt: z.number().int().nullable(),
});
const devicesSchema = z.object({ data: z.array(deviceSchema), nextCursor: z.string().nullable() });
const pairSchema = z.object({ pairingCode: z.string().min(1), manualPairingCode: z.string().nullable(), environmentId: z.string(), expiresAt: z.number().int().positive() });
export type NativeRemote = z.infer<typeof remoteSchema>;
export type RemoteDevice = z.infer<typeof deviceSchema>;
export type Pairing = { pairingUrl: string; manualPairingCode: string | null; expiresAtIso: string };
export type Status = {
  daemon: 'running' | 'stopped'; status: NativeRemote['status'] | 'unavailable';
  serverName?: string; installationId?: string; environmentId?: string | null;
  cliVersion?: string; appServerVersion?: string;
  pairing: 'paired' | 'unpaired' | 'unknown'; pairedDevices: number | null; diagnostic?: string;
};
type Connector = (socketPath: string) => Promise<Rpc>;
function valid<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RemoteError('protocol_error', 'Codex returned an incompatible remote-control response. No restart was attempted.');
  return result.data;
}
const running = (info: DaemonInfo) => ['running', 'started', 'alreadyRunning'].includes(info.status);

export class RemoteService {
  constructor(private host: NativeHost = new CodexHost(), private connect: Connector = path => SocketRpc.connect(path), private readyTimeoutMs = 15000) {}
  private async use<T>(info: DaemonInfo, run: (rpc: Rpc) => Promise<T>): Promise<T> {
    if (!running(info)) throw new RemoteError('daemon_unavailable', 'The Codex daemon is not running. Run codex-remote enable first.');
    const rpc = await this.connect(info.socketPath);
    try { return await run(rpc); } finally { rpc.close(); }
  }
  private async read(rpc: Rpc) { return valid(remoteSchema, await rpc.request('remoteControl/status/read')); }
  private async clients(rpc: Rpc, environmentId: string) {
    const clients: RemoteDevice[] = []; const cursors = new Set<string>(); let cursor: string | null = null;
    do {
      const page: z.infer<typeof devicesSchema> = valid(devicesSchema, await rpc.request('remoteControl/client/list', { environmentId, cursor, limit: 100, order: 'desc' }));
      clients.push(...page.data); cursor = page.nextCursor;
      if (cursor) {
        if (cursors.has(cursor) || cursors.size >= 100) throw new RemoteError('protocol_error', 'Codex returned an invalid device-list cursor.');
        cursors.add(cursor);
      }
    } while (cursor);
    return clients;
  }
  private async summary(info: DaemonInfo, _rpc: Rpc, remote: NativeRemote): Promise<Status> {
    // The restricted default profile reports relay state only and never enumerates device records.
    return { daemon: 'running', status: remote.status, serverName: remote.serverName, cliVersion: info.cliVersion, appServerVersion: info.appServerVersion, pairing: 'unknown', pairedDevices: null };
  }
  async status(): Promise<Status> {
    const info = await this.host.version();
    if (!running(info)) return { daemon: 'stopped', status: 'unavailable', pairing: 'unknown', pairedDevices: null, cliVersion: info.cliVersion, diagnostic: 'The remote daemon is stopped. Status will not start it; request a pairing QR only when you intend to enable persistent remote access.' };
    return this.use(info, async rpc => this.summary(info, rpc, await this.read(rpc)));
  }
  async enable(): Promise<Status> {
    let info = await this.host.version();
    if (!running(info)) info = await this.host.start();
    return this.use(info, async rpc => {
      // The daemon CLI toggle commands restart active sessions in 0.163.0.
      // These RPCs persist daemon settings in place. Never substitute lifecycle toggles.
      let remote = valid(remoteSchema, await rpc.request('remoteControl/enable', { ephemeral: false }));
      const deadline = Date.now() + this.readyTimeoutMs;
      while (remote.status === 'connecting' && Date.now() < deadline) { await delay(Math.min(250, Math.max(1, deadline - Date.now()))); remote = await this.read(rpc); }
      return this.summary(info, rpc, remote);
    });
  }
  async disable(): Promise<Status> {
    const info = await this.host.version();
    if (!running(info)) throw new RemoteError('daemon_unavailable', 'No daemon is running. Remote access was not changed; its saved preference may still be enabled.');
    return this.use(info, async rpc => this.summary(info, rpc, valid(remoteSchema, await rpc.request('remoteControl/disable', { ephemeral: false }))));
  }
  async pair(): Promise<Pairing> {
    const info = await this.host.version();
    return this.use(info, async rpc => {
      const remote = await this.read(rpc);
      if (remote.status !== 'connected' || !remote.environmentId) throw new RemoteError('remote_not_ready', `Remote access is ${remote.status}. Request a new QR to enable it, or check Codex sign-in and workspace policy.`);
      const pair = valid(pairSchema, await rpc.request('remoteControl/pairing/start', { manualCode: true }));
      if (pair.environmentId !== remote.environmentId) throw new RemoteError('protocol_error', 'The pairing environment changed. Check host status before requesting a new code.');
      if (pair.expiresAt * 1000 <= Date.now()) throw new RemoteError('pairing_expired', 'Codex returned an expired pairing code. Request a new code.');
      const url = new URL('https://chatgpt.com/codex/pair'); url.searchParams.set('pairing_code', pair.pairingCode);
      let expiresAtIso: string;
      try { expiresAtIso = new Date(pair.expiresAt * 1000).toISOString(); }
      catch { throw new RemoteError('protocol_error', 'Codex returned an invalid pairing expiration.'); }
      return { pairingUrl: url.toString(), manualPairingCode: pair.manualPairingCode, expiresAtIso };
    });
  }
  /** Requesting a QR explicitly enables persistent remote access when necessary. */
  async qr(): Promise<Pairing> {
    const status = await this.status();
    if (status.status !== 'connected') {
      const enabled = await this.enable();
      if (enabled.status !== 'connected') throw new RemoteError('remote_not_ready', `Remote access is ${enabled.status}. Check codex-remote status before retrying pairing.`);
    }
    return this.pair();
  }
  async devices() {
    const info = await this.host.version();
    return this.use(info, async rpc => {
      const remote = await this.read(rpc);
      if (remote.status !== 'connected' || !remote.environmentId) throw new RemoteError('remote_not_ready', 'Connect remote access before listing paired devices. Disabled access does not mean existing pairings were removed.');
      return { environmentId: remote.environmentId, devices: await this.clients(rpc, remote.environmentId) };
    });
  }
  async revoke(clientId: string) {
    if (!clientId || clientId.length > 200 || /[\x00-\x1f\x7f]/.test(clientId)) throw new RemoteError('invalid_device', 'Supply a device ID from codex-remote devices list.');
    const info = await this.host.version();
    return this.use(info, async rpc => {
      const remote = await this.read(rpc);
      if (remote.status !== 'connected' || !remote.environmentId) throw new RemoteError('remote_not_ready', 'Connect remote access before revoking a device.');
      const clients = await this.clients(rpc, remote.environmentId);
      if (!clients.some(device => device.clientId === clientId)) throw new RemoteError('device_not_found', 'That device is not paired with this host. Refresh the device list.');
      valid(z.object({}), await rpc.request('remoteControl/client/revoke', { environmentId: remote.environmentId, clientId }));
      return { revoked: true, clientId, environmentId: remote.environmentId };
    });
  }
}
