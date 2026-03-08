# Configuration

## Plugin Settings

All settings are configured via **Settings → Community plugins → Remarkable Sync**.

| Setting         | Default     | Description                                                                               |
| --------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Target folder   | `""` (root) | Vault-relative path where output files are saved                                          |
| Save images     | `true`      | Save rendered page images                                                                 |
| Image format    | `jpeg`      | Format for rendered images (`jpeg`, `webp`, or `png`). JPEG/WebP are smaller.             |
| Image quality   | `0.85`      | Quality for JPEG/WebP (0.1–1.0). Higher = better quality, larger files. No effect on PNG. |
| Use rmfakecloud | `false`     | Connect to a self-hosted rmfakecloud server instead of official cloud                     |
| Server URL      | `""`        | Base URL of rmfakecloud server (only when rmfakecloud is enabled)                         |

## Authentication

Tokens are stored at `~/.remarkable-sync/token.json` (outside the vault).

The file contains:

- `deviceToken`: Long-lived device registration token
- `userToken`: Short-lived API token (24h expiry, auto-refreshed)
- `userTokenExpiry`: Timestamp for token refresh

## Environment Variables

| Variable                  | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `OBSIDIAN_VAULT_LOCATION` | Dev only: auto-copy built plugin to vault for testing |

## Build Configuration

- Source: `src/main.ts` → Output: `dist/main.js`
- CSS: `src/styles.src.css` → Output: `dist/styles.css`
- Assets copied from `src/assets/` to `dist/`
- External modules (not bundled): `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`
