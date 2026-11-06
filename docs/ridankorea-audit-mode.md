# Ridan Korea: read-only audit deployment

This document describes the intended host configuration for the restricted Codex Remote branch. It is a deployment guide, not an automatic installer. Review paths and account state before running any command.

## Isolation requirements

1. Keep production at `/var/www/ridankorea`, its PM2 user, Node.js 22 runtime, Nginx, and Neon configuration unchanged.
2. Create a dedicated unprivileged Linux account named `codex-audit`.
3. Give it access only to a sanitized, separate copy of the source. Do not mount or grant access to the production project directory.
4. Store its Codex authentication and configuration under its own home and `CODEX_HOME`.
5. Do not provide Neon connection strings, SSH private keys, GitHub tokens, `.env*`, backups, or production logs.
6. Do not grant sudo, Docker group membership, PM2 access, or write permission to production paths.

## Codex configuration

Create the dedicated user's `~/.codex/config.toml`:

```toml
sandbox_mode = "read-only"
approval_policy = "never"
allow_login_shell = false
```

Codex documents `read-only` as the mode for preventing model-generated shell commands from writing within the sandbox. The `never` approval policy avoids interactive approval prompts; it does not grant additional sandbox permissions. Keep network access disabled.

Use the dedicated user's `CODEX_HOME` consistently for authentication, plugin installation, and the Codex session. Authenticate Codex as that user; do not copy another user's authentication files.

## Sanitized source snapshot

A suitable snapshot is copied from source control or from the production source after excluding secrets and runtime data. If copying from the production checkout, first review the exclude list and destination:

```sh
sudo install -d -o root -g codex-audit -m 0750 /srv/ridankorea-audit
sudo rsync -a \
  --exclude='.env*' \
  --exclude='**/.env*' \
  --exclude='.git' \
  --exclude='.npmrc' \
  --exclude='.git-credentials' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='logs' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='*.p12' \
  /var/www/ridankorea/ /srv/ridankorea-audit/
sudo chown -R root:codex-audit /srv/ridankorea-audit
sudo find /srv/ridankorea-audit -type d -exec chmod 0550 {} +
sudo find /srv/ridankorea-audit -type f -exec chmod 0440 {} +
```

The snapshot command is illustrative. Inspect the project for application-specific secret or private-data directories and add exclusions before running it. Do not copy secrets into the audit snapshot and then rely on Codex instructions not to read them.

## Restricted plugin surface

The default MCP surface contains exactly two tools:

- `remote_status`: reads the native relay state only. It does not start the daemon, change remote settings, or enumerate devices.
- `remote_pair`: only used when the user explicitly requests a pairing QR. It enables persistent native remote access if needed.

Admin tools and device-management operations are not registered by default. The environment variable `CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1` is a deliberate operator opt-in and must not be set in the audit service. Terminal Extensions and `/qr` are separately disabled unless `CODEX_REMOTE_ENABLE_TERMINAL_EXTENSIONS=1` is set.

To disable native remote access locally after pairing:

```sh
CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1 codex-remote disable
```

## Validation before use

As the operator, verify:

- `codex-audit` is not in sudo, docker, or production service groups.
- The source snapshot is readable by `codex-audit` but not writable.
- `.env*`, private keys, credentials, backups, and logs are absent.
- The dedicated `CODEX_HOME/config.toml` contains the read-only settings above.
- Codex starts with `read-only` sandbox mode and network disabled.
- The MCP server lists only `remote_status` and `remote_pair`.
- A deliberate attempt to create or modify a file in the source snapshot is denied.
- Production Node.js, PM2, Neon, and the live project directory remain unchanged.

Codex sandboxing and Linux filesystem permissions are separate layers; use both. This branch does not itself create Linux accounts, install Node.js, or change server permissions.
