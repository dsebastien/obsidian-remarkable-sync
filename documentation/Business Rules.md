# Business Rules

This document defines the core business rules. These rules MUST be respected in all implementations unless explicitly approved otherwise.

---

## Documentation Guidelines

When a new business rule is mentioned:

1. Add it to this document immediately
2. Use a concise format (single line or brief paragraph)
3. Maintain precision - do not lose important details for brevity
4. Include rationale where it adds clarity

---

## Authentication

- Tokens are stored in the plugin's `data.json` under the `tokens` key, so the same code path works on desktop and mobile (nothing outside the vault is writable on mobile)
- Tokens MUST NOT be part of `PluginSettings`: the settings object is written to the debug log on every load and save, and users paste it into bug reports
- Every `data.json` write goes through `plugin.persistData()`, which merges into the last known contents and serializes writes — `saveData` replaces the whole file, so a plain settings save would otherwise erase the tokens
- Desktop installs that predate this change keep their tokens in `~/.remarkable-sync/token.json`; that file is imported once per vault on first read and is deliberately never deleted automatically (it is machine-global and shared by every vault on the machine). Users remove it explicitly from the settings tab
- The legacy file is consulted at most once per vault, tracked via the `legacyTokensImported` key in `data.json` — otherwise disconnecting would be undone by a re-import on the next read
- Device tokens are long-lived; user tokens expire after 24h and auto-refresh using the device token
- All HTTP requests use Obsidian's `requestUrl` for plugin compliance and CORS handling
- Users authenticate via a one-time code from `my.remarkable.com/device/desktop/connect` (official) or the rmfakecloud web interface
- Plugin load must never fail because of stored token contents: malformed tokens (in `data.json` or in the legacy file) are treated as disconnected, validated on read

## Document Processing

- Blank pages (no strokes, or only eraser strokes) are skipped entirely — no image generated
- The plugin supports .rm v6 binary format for stroke data
- CRDT text data in .rm files is not processed in v0.1.0

## Sync

- Sync state persists across sessions (stored in plugin data alongside settings)
- A notebook is "synced" when its local `lastSyncedAt` >= cloud `lastModifiedCloud`
- "Sync all" only processes notebooks with `needs-sync` or `never-synced` status
- Sync state is cleared when user disconnects from reMarkable cloud
- Users can sync individual notebooks, multiple selected notebooks, or all notebooks at once
- On every successful cloud listing (panel refresh or automatic sync), sync-state entries whose notebook no longer exists in the cloud are pruned; generated vault files are never deleted automatically
- Automatic background sync is opt-in (default off); the interval is clamped to 5–240 minutes (default 30); runs are skipped while disconnected or when a previous run is still in progress; timers are registered via `registerInterval` so they are cleaned up on unload

## Local Import

- .rmdoc files can be imported without a cloud connection
- Imported files are processed through the same parse → render → save pipeline as cloud-synced notebooks
- Imported notebooks use the metadata `visibleName` if available, otherwise the file name (minus `.rmdoc` extension)
- Imported files are saved under the configured target folder with no subfolder hierarchy (empty folder path)
- Imported files are not tracked in sync state (they are one-shot imports)

## Render failures

- Content pages that fail to render are never dropped silently: the pipeline counts them, the panel shows "Done — N pages failed to render" (warning color), and the completion Notice reports processed/total counts
- Failed pages are excluded from `syncedPageCount`; the notebook itself is still marked synced (a deterministic render failure would otherwise re-sync forever, especially with automatic sync)

## Panel

- Notebooks are sorted within each folder by the `panelSortOrder` setting (default: recently modified first). Folders keep their own ordering: the top-level group first, then the rest alphabetically
- An unrecognised `panelSortOrder` falls back to the default rather than breaking the list, so an old or hand-edited value is harmless
- Name comparison is case-insensitive and numeric-aware, so "Notebook 2" precedes "Notebook 10"
- Sorting by date breaks ties on name, so the order is total and the list cannot reshuffle between renders

## Output

- reMarkable folder hierarchy is preserved under the target folder
- Images are saved when `saveImages` is enabled

## rmfakecloud

- When rmfakecloud is enabled, both auth and sync endpoints use the same user-provided base URL
- Tokens from the official cloud are not valid on rmfakecloud (and vice versa); users must disconnect and reconnect when switching
- The rmfakecloud URL must be a valid HTTP or HTTPS URL
- When rmfakecloud is enabled but no URL is configured, the plugin falls back to the official cloud
- When rmfakecloud is enabled, network requests go to the user's self-hosted server instead of reMarkable cloud

## Privacy & Security

- No telemetry or analytics
- No data sent to third-party services other than reMarkable cloud (or rmfakecloud when enabled)
- Tokens live in the plugin's `data.json` inside the vault. Consequence users must be told about: enabling Obsidian Sync's community-plugin-settings option, or syncing `.obsidian` via Git/Dropbox, propagates the credentials too
- Tokens are per-vault, not per-machine
- Node builtins (`fs`/`os`/`path`) must never be imported at the top level of any module under `src/`: the bundler hoists them into a top-level `require`, which throws on mobile and prevents the plugin from loading. Require them lazily inside a `Platform.isDesktopApp` guard
- Dependencies that ship a browser entry point must be imported through it (e.g. `fflate/browser`, not `fflate`). `scripts/build.ts` uses `target: 'node'`, so Bun otherwise resolves the Node entry and can pull top-level Node builtins into the bundle. Do not switch the build to `target: 'browser'` to fix this: Bun then silently rewrites `require('node:fs')` to an empty-object stub, which would break the legacy token import without any error
- After changing or adding a bundled dependency, check `dist/main.js` for unexpected `require(...)` calls and for `createElement("script")` / `new Worker` / `createObjectURL`, all of which the community-plugin reviewer flags
- The shipped stylesheet must never contain a global reset. A plugin's `styles.css` is injected into the whole Obsidian document, so Tailwind Preflight would restyle the entire app, not just this plugin's views. Import `tailwindcss/theme` and `tailwindcss/utilities` explicitly, never bare `tailwindcss`. Anything the plugin needs from a reset is scoped to `[class^='remarkable-']`, and never as a blanket descendant `margin`/`padding` reset: those rules are unlayered and would outrank Obsidian's own `.markdown-rendered` spacing
