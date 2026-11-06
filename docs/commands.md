---
title: Restricted commands and MCP tools
description: Commands and default MCP tools for the Ridan Korea read-only audit profile.
permalink: /commands/
---
{% include nav.html %}

# Restricted commands and MCP tools

The default profile intentionally exposes only relay status and explicit phone pairing.

| Command | Behavior |
| --- | --- |
| `codex-remote status` | Read relay status without starting the daemon or changing settings. |
| `codex-remote qr` | Create a pairing QR when explicitly requested; enables persistent remote access if needed. |
| `codex-remote pair` | Alias for `qr`. |
| `codex-remote install` | Register the local plugin. Terminal Extensions are not auto-registered. |
| `codex-remote serve` | Run the restricted MCP server over stdio. |

## Default MCP tools

| MCP tool | Permission |
| --- | --- |
| `remote_status` | Read-only relay status. Does not enumerate device records. |
| `remote_pair` | Stateful pairing action. Use only after the user asks for a QR or phone pairing. Enables persistent remote access. |

The following tools are absent from the default MCP registry: `remote_enable`, `remote_disable`, `remote_devices_list`, and `remote_device_revoke`.

## Future opt-ins

Administrative tools and CLI commands can be restored by an operator with:

```sh
CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1
```

Set this only in a trusted operator environment. It exposes persistent enable/disable and paired-device administration.

Terminal Extensions and the `/qr` command are independently disabled. To opt in locally:

```sh
CODEX_REMOTE_ENABLE_TERMINAL_EXTENSIONS=1 codex-remote terminal enable
```

## Remote pairing lifecycle

A QR request enables persistent native remote access when necessary. Access remains enabled until an operator disables it locally. Pairing credentials are short-lived and must be kept private.

For emergency local disable, use an operator shell:

```sh
CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1 codex-remote disable
```

The default agent profile cannot disable access or revoke devices. This is deliberate.

## Security boundary

This plugin does not enforce Codex's filesystem sandbox. Use the OS-enforced `read-only` Codex sandbox, a dedicated Linux user, a separate source snapshot, and no production database credentials. See the [Ridan Korea audit deployment guide](https://github.com/esmail-sharif/codex-remote/blob/ridankorea-audit-only/docs/ridankorea-audit-mode.md).
