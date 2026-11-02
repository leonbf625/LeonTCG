# Discord backup and DiscordChatExporter receiver downloads

- **All-Code-and-Windows-Test.zip**: current source, tests, documentation, complete
  Cloudflare receiver, Windows x64 backup EXE and JSON folder-upload mode.
- **All-Code.zip**: source and single-file Worker without the EXE.
- **Cloudflare-Receiver.js**: complete single-file Worker to paste into Cloudflare.
  Reuse EXPORTS; configure DASHBOARD_EMAIL, DASHBOARD_PASSWORD and UPLOAD_TOKEN.
- **SHA256SUMS.txt** and **BUNDLE-SHA256SUMS.txt**: archive checksums.

Receiver update: protected website, JSON file upload/list/download, strict message
counts, SHA-256 receipts, duplicate retry handling, legacy export support and
paginated KV listing without a shared mutable index. The Windows uploader can
watch a JSON folder, split large exports and skip already-confirmed parts.

No credentials, real Discord messages, backup databases or personal service/account
settings are included. Public placeholders must be configured before deployment.

Validation: 30 Python tests, 15 Worker tests, two launcher tests and two Chromium
flows passed locally with synthetic data. Windows execution, real Discord access,
live Worker changes and deployed Cloudflare persistence remain unverified.
The live service was not modified. This download branch preserves main.
