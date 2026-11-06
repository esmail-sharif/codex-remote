---
title: Install the Ridan Korea audit profile
description: Install the restricted Codex Remote plugin for a dedicated read-only Ridan Korea audit environment.
permalink: /install/
---
{% include nav.html %}

# Install the Ridan Korea audit profile

Install this branch under a dedicated, unprivileged Linux account that has read-only access to a sanitized source snapshot. Do not install it under the PM2 production user or root.

## Requirements

- Ubuntu 24.04 ARM64 or another tested Linux environment.
- Node.js 24+ for this audit user only.
- Codex CLI authenticated in this dedicated user's own `CODEX_HOME`.
- ChatGPT mobile signed in with the same account and workspace.
- A compatible native Codex remote managed-server interface.

Keep the production Ridan Korea Node.js 22 runtime and PM2 service unchanged.

## Build and install

From a clean checkout of this branch:

```sh
npm ci
npm run build
npm install --global --prefix "$HOME/.local" --ignore-scripts .
export PATH="$HOME/.local/bin:$PATH"
codex-remote install
```

Open a new Codex terminal so the restricted plugin loads. Only `remote_status` and `remote_pair` appear by default.

## Pair the phone

Ask Codex **“Show the QR for remote session pairing”** only when you intend to enable persistent remote access. Scan the short-lived QR with the ChatGPT mobile app, using the same account and workspace as the dedicated Codex session.

A QR request enables persistent native remote access and it stays enabled until an operator disables it locally. Keep pairing credentials private.

## Do not skip the audit sandbox

Configure the dedicated user's `$CODEX_HOME/config.toml` with:

```toml
sandbox_mode = "read-only"
approval_policy = "never"
allow_login_shell = false
```

Also enforce read-only project access and exclude all secrets at the Linux filesystem level. Follow the [Ridan Korea audit deployment guide](https://github.com/esmail-sharif/codex-remote/blob/ridankorea-audit-only/docs/ridankorea-audit-mode.md) before using this on the production server.

## Disable remote access

The agent's default MCP surface deliberately lacks an administrative disable tool. From a trusted local operator shell, run:

```sh
CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1 codex-remote disable
```

Do not set the admin opt-in in the default audit MCP environment.
