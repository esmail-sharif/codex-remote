# Ridan Korea Audit Remote

A restricted profile of [Codex Remote](https://github.com/Cheaux/codex-remote) for pairing the ChatGPT mobile app with a dedicated Codex audit session.

This branch is intended for **read-only analysis of Ridan Korea**. It is a community-maintained adaptation; it is not an official OpenAI product.

## Default tool surface

Only two MCP tools are exposed to Codex:

| Tool | Default behavior |
| --- | --- |
| `remote_status` | Read the native relay status. Does not start the daemon, modify settings, or enumerate paired-device records. |
| `remote_pair` | Available only when the user explicitly asks to pair a phone or show a QR. Enables persistent native remote access if required, then returns a short-lived pairing QR and code. |

Requesting a QR enables persistent native remote access. It remains enabled until an operator disables it locally. Keep real QR images and pairing codes private.

The following MCP tools are hidden by default: `remote_enable`, `remote_disable`, `remote_devices_list`, and `remote_device_revoke`. They can be restored later with the explicit operator environment setting `CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1`. Do not set this in the default audit deployment.

Terminal Extensions and `/qr` registration are also disabled by default. Re-enabling them requires `CODEX_REMOTE_ENABLE_TERMINAL_EXTENSIONS=1`.

## Important security boundary

Hiding MCP tools is **not** a filesystem sandbox. This plugin only controls its own remote-pairing tools. To keep Ridan Korea safe:

- Run Codex as a dedicated unprivileged Linux account, not as root or the PM2 production user.
- Give that account read-only access to a separate source snapshot, not the live production directory.
- Exclude `.env*`, credentials, private keys, backups, logs, Git credentials, and other secrets from that snapshot.
- Use Codex's OS-enforced `read-only` sandbox; keep shell network access disabled.
- Do not provide Neon credentials or production database write access.
- Keep Node.js 22 and the production PM2 process unchanged; install Node.js 24 only in the dedicated audit environment.

See [Ridan Korea audit deployment](docs/ridankorea-audit-mode.md) for the recommended operating-system and Codex configuration.

## Requirements

- Node.js 24 or newer.
- Codex CLI signed in under the dedicated audit account.
- A compatible native Codex managed-server remote interface.
- The official ChatGPT mobile app signed in with the same account and workspace.

The native remote-control interface is experimental and its availability can vary by Codex version and workspace policy.

## Install this branch

Build and install this branch under the dedicated audit user. The plugin is registered into that user's `CODEX_HOME`:

```sh
npm ci
npm run build
npm install --global --prefix "$HOME/.local" --ignore-scripts .
export PATH="$HOME/.local/bin:$PATH"
codex-remote install
```

Open a new Codex terminal. Ask **“Show the QR for remote session pairing”** only when you intend to enable persistent remote access. For ordinary checks, ask **“Check the native remote relay status.”**

## Operator-only recovery

Administrative CLI actions require an explicit, temporary local environment opt-in. For example, to turn off remote access from an operator shell:

```sh
CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1 codex-remote disable
```

To restore administrative MCP tools in a later deployment, set `CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1` in that MCP server's environment. This is intentionally not set in the audit profile.

Terminal Extensions can be enabled separately, only when deliberately requested:

```sh
CODEX_REMOTE_ENABLE_TERMINAL_EXTENSIONS=1 codex-remote terminal enable
```

## Upstream and attribution

The restricted profile is based on [Cheaux/codex-remote](https://github.com/Cheaux/codex-remote), licensed under MIT. The upstream author and project are not affiliated with or endorsed by OpenAI.
