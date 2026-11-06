# Ridan Korea Audit Remote: data handling

This restricted profile is based on [Cheaux/codex-remote](https://github.com/Cheaux/codex-remote), a community project not maintained or endorsed by OpenAI.

The local MCP server communicates with the native Codex service on the audit computer. When the user explicitly requests pairing, the short-lived pairing URL/code and expiry are returned to the Codex conversation. Keep displayed QR images, links, and codes private. The plugin does not persist pairing credentials, operate a relay, analytics service, or hosted database.

The default MCP profile exposes only relay status and explicit pairing. It does not enumerate paired-device records. Administrative controls are hidden unless an operator explicitly enables them with `CODEX_REMOTE_ENABLE_ADMIN_TOOLS=1`. Terminal Extensions are separately disabled by default.

Native Codex and ChatGPT manage authentication, remote relay traffic, and persistent paired-device records under their own policies. This document describes this community project; it does not replace the policies of Codex, ChatGPT, your model provider, or other feature packages.

Do not post private chats, credentials, pairing codes, or account identifiers in public issues. Use synthetic or redacted examples when reporting problems.
