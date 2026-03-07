# Configuration

All settings are accessible via **Settings → Community plugins → Remarkable Sync**.

## Settings

| Setting       | Type     | Default | Description                                                                   |
| ------------- | -------- | ------- | ----------------------------------------------------------------------------- |
| Target folder | text     | `""`    | Vault-relative path where output files are saved. Leave empty for vault root. |
| Save images   | toggle   | `true`  | Save rendered page images                                                     |
| Image format  | dropdown | `png`   | Format for rendered images: PNG or JPEG                                       |

## Authentication

The authentication section shows your connection status and provides connect/disconnect buttons.

Tokens are stored at `~/.remarkable-sync/token.json` (outside the vault for security). The user token auto-refreshes every 23 hours.

## About

The about section includes links to follow the developer and support the project.
