# Configuration

## Plugin Settings

All settings are configured via **Settings → Community plugins → Remarkable Synchronizer**.

| Setting         | Default     | Description                                                                               |
| --------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Target folder   | `""` (root) | Vault-relative path where output files are saved                                          |
| Save images     | `true`      | Save rendered page images                                                                 |
| Image format    | `jpeg`      | Format for rendered images (`jpeg`, `webp`, or `png`). JPEG/WebP are smaller.             |
| Image quality   | `0.85`      | Quality for JPEG/WebP (0.1–1.0). Higher = better quality, larger files. No effect on PNG. |
| Use rmfakecloud | `false`     | Connect to a self-hosted rmfakecloud server instead of official cloud                     |
| Server URL      | `""`        | Base URL of rmfakecloud server (only when rmfakecloud is enabled)                         |
| Automatic sync  | `false`     | Opt-in background sync of all notebooks that need updating                                |
| Sync interval   | `30`        | Minutes between automatic syncs (clamped 5–240; only when automatic sync is enabled)      |

## Authentication

Tokens are stored in the plugin's `data.json` under the `tokens` key — deliberately outside `PluginSettings`, which is written to the debug log on every load/save.

The entry contains:

- `deviceToken`: Long-lived device registration token
- `userToken`: Short-lived API token (24h expiry, auto-refreshed)
- `userTokenExpiry`: Timestamp for token refresh

Desktop installs predating this change kept the same fields in `~/.remarkable-sync/token.json`. That file is imported once per vault on first read (tracked by the `legacyTokensImported` key in `data.json`) and is never deleted automatically — it is machine-global and shared by every vault. The settings tab offers explicit removal.

## Environment Variables

| Variable                  | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `OBSIDIAN_VAULT_LOCATION` | Dev only: auto-copy built plugin to vault for testing |

## Build Configuration

- Source: `src/main.ts` → Output: `dist/main.js`
- CSS: `src/styles.src.css` → Output: `dist/styles.css`
- Assets copied from `src/assets/` to `dist/`
- External modules (not bundled): `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`
