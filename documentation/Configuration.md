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

The device token is stored in Obsidian's `app.secretStorage` (device-local). `PluginSettings` holds only:

- `deviceTokenSecretName`: secret id (`''` = not paired; default name on first pairing `remarkable-synchronizer-device-token`, suffixed `-2`, `-3`... if taken by a different value)
- `legacySecretMigratedAt`: ISO date of the first migration out of plaintext (`''` = none)

The user token is memory-only, regenerated from the device token (one request per session).

Legacy (≤ 2.3): `data.json` `tokens` key (`deviceToken`, `userToken`, `userTokenExpiry`). Never written anymore. Read-only bootstrap: any device whose secret storage lacks the token copies it from there on load. Removed 60 days after `legacySecretMigratedAt`, on re-pairing, on secret name change, on disconnect, or via the **Remove plain-text copy now** button.

Desktop installs predating `data.json` storage kept the same fields in `~/.remarkable-sync/token.json`. That file is imported into secret storage once per vault on first read (tracked by the `legacyTokensImported` key in `data.json`) and is never deleted automatically — it is machine-global and shared by every vault. The settings tab offers explicit removal.

## Environment Variables

| Variable                  | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `OBSIDIAN_VAULT_LOCATION` | Dev only: auto-copy built plugin to vault for testing |

## Build Configuration

- Source: `src/main.ts` → Output: `dist/main.js`
- CSS: `src/styles.src.css` → Output: `dist/styles.css`
- Assets copied from `src/assets/` to `dist/`
- External modules (not bundled): `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`
