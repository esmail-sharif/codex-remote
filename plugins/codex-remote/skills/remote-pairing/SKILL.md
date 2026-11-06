---
name: remote-pairing
description: Show a QR for pairing ChatGPT on Android or iPhone with terminal Codex, or read the native relay status. Use for Codex remote session pairing, not unrelated QR codes or remote desktop software.
---

The restricted Codex Remote profile exposes only two MCP tools by default:

- `remote_status`: read the native relay state. It does not start the daemon, change settings, or enumerate paired-device records. A connected relay is not proof that a phone is paired.
- `remote_pair`: use only after the user explicitly asks to pair a phone or show a pairing QR. This operation enables persistent native remote access if needed, then returns a short-lived QR image, link, manual code, and expiry.

When pairing is requested, call `remote_pair`, present the returned QR image where supported, and show the expiry. In terminal conversation output, reproduce `qrText` exactly inside a fenced code block, preserving spaces and line breaks. Do not regenerate the QR with an image tool. Never invent a pairing code or claim that issuing a QR proves successful pairing. The user scans with Android or iPhone and completes setup in ChatGPT using the same account and workspace. Keep pairing credentials private.

**Important:** requesting a QR turns on persistent remote access and it remains enabled until an operator disables it locally. The default profile intentionally does not expose enable/disable, device-list, or device-revocation tools to the agent. Do not work around this restriction by running shell commands, calling native Codex administrative commands, or changing environment flags.

All administrative MCP tools are disabled by default. An operator may deliberately restore them later by setting `CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1` in the MCP server environment. Terminal Extensions and `/qr` are independently disabled by default and require `CODEX_REMOTE_ENABLE_TERMINAL_EXTENSIONS=1`. Do not enable either feature unless the operator explicitly requests it.

For ordinary status checks, use `remote_status`; do not issue a new QR unless requested. Remote pairing uses the existing native Codex managed service. Do not copy native tokens, pairings, or threads into plugin storage.
