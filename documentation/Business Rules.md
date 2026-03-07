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

- Tokens are stored outside the vault at `~/.remarkable-sync/token.json` for security
- Device tokens are long-lived; user tokens expire after 24h and auto-refresh using the device token
- All HTTP requests use Obsidian's `requestUrl` for plugin compliance and CORS handling
- Users authenticate via a one-time code from `my.remarkable.com/device/desktop/connect`

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

## Local Import

- .rmdoc files can be imported without a cloud connection
- Imported files are processed through the same parse → render → save pipeline as cloud-synced notebooks
- Imported notebooks use the metadata `visibleName` if available, otherwise the file name (minus `.rmdoc` extension)
- Imported files are saved under the configured target folder with no subfolder hierarchy (empty folder path)
- Imported files are not tracked in sync state (they are one-shot imports)

## Output

- reMarkable folder hierarchy is preserved under the target folder
- Images are saved when `saveImages` is enabled

## Privacy & Security

- No telemetry or analytics
- No data sent to third-party services other than reMarkable cloud
- Token storage is outside the vault to prevent accidental sync/sharing
- Plugin is desktop-only due to OffscreenCanvas and filesystem token storage
