import { version } from './version.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RemoteService } from './service.js';
import { errorResult } from './errors.js';
import { pairingPng, pairingText } from './pairing.js';

export interface McpOptions {
  /** Opt in to host administration tools. Disabled unless explicitly enabled by the operator. */
  adminTools?: boolean;
}

export function createMcpServer(service = new RemoteService(), options: McpOptions = {}) {
  const server = new McpServer({ name: 'codex-remote', version });
  const adminTools = options.adminTools ?? process.env.CODEX_REMOTE_ENABLE_ADMIN_TOOLS === '1';
  const tool = (name: string, description: string, inputSchema: z.ZodRawShape, readOnly: boolean, destructive: boolean, idempotent: boolean, run: (args: any) => Promise<CallToolResult>) => {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: true } }, async args => {
      try { return await run(args); }
      catch (error) { const value = errorResult(error); return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: value }) }], structuredContent: { error: value } }; }
    });
  };
  const result = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: { result: value } });

  // Restricted default surface: relay status and an explicitly requested phone pairing QR.
  tool('remote_status', 'Read native relay status without starting the daemon, changing settings, or enumerating paired-device records. Relay connectivity is not proof that a phone is paired.', {}, true, false, true, async () => result(await service.status()));
  tool('remote_pair', 'Only when the user explicitly requests phone pairing, create a short-lived QR/link/code. This enables persistent native remote access if needed; access remains enabled until an operator disables it locally. Existing pairings are preserved.', {}, false, false, false, async () => {
    const pair = await service.qr(); const png = await pairingPng(pair); const output = { ...pair, qrText: pairingText(pair) };
    return { content: [
      { type: 'text', text: JSON.stringify({ ...output, instructions: 'Show the QR image when supported. In terminal conversation output, reproduce qrText exactly inside a fenced code block, then provide the pairing link and expiration. Scan with Android or iPhone and finish in ChatGPT using the same account/workspace. Keep the QR and pairing code private. Persistent remote access remains enabled until an operator disables it locally.' }, null, 2) },
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
    ], structuredContent: { result: output } };
  });

  // These administration tools remain available for a deliberate future opt-in only.
  if (adminTools) {
    tool('remote_enable', 'ADMIN ONLY: Enable persistent ChatGPT phone access through the existing Codex socket. Starts the native daemon only if absent; never restarts a running server.', {}, false, false, true, async () => result(await service.enable()));
    tool('remote_disable', 'ADMIN ONLY: Disable persistent phone access without stopping Codex or local sessions. This disconnects remote clients but preserves paired devices.', {}, false, true, true, async () => result(await service.disable()));
    tool('remote_devices_list', 'ADMIN ONLY: List paired devices and their identifiers, platform, and last-seen timestamps.', {}, true, false, true, async () => result(await service.devices()));
    tool('remote_device_revoke', 'ADMIN ONLY: Revoke one explicitly chosen device using its client_id from remote_devices_list.', { client_id: z.string().min(1).max(200) }, false, true, false, async args => result(await service.revoke(args.client_id)));
  }
  return server;
}

export async function serve() { await createMcpServer().connect(new StdioServerTransport()); }
