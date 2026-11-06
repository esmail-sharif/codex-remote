# Changelog

## 0.3.0 — Ridan Korea audit-only profile

- Restricted default MCP tools to relay status and explicitly requested QR pairing.
- Removed paired-device enumeration from the default status operation.
- Gated remote enable/disable and paired-device management behind `CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1`.
- Disabled Terminal Extensions and `/qr` registration unless explicitly opted in.
- Added read-only audit deployment guidance for a dedicated Linux user and sanitized source snapshot.

## 0.2.1

- Updated shared-host references to Codex Command Extensions. Added official-directory draft ZIP packaging, listing metadata, icons, public data/license information and proposed review cases.

## 0.2.0 — 2026-10-17

- `/qr` now registers with Codex Command Extensions independently of Folders.
- Added terminal enable/disable/status commands; installation registers when the host is present.
- Native phone pairing, MCP tools, saved devices, and active sessions retain their existing behavior.
- Terminal integration tests now run against the shared host without a Folders checkout.

## 0.1.0 — 2026-10-17

Initial public release.
