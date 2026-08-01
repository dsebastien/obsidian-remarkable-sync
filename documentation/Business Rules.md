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
- PDF export is opt-in via `savePdf` (default false) and is independent of `saveImages`: either, both, or neither may be enabled
- A notebook PDF is written to `<targetFolder>/<folderPath>/<notebookName>.pdf`, beside the per-notebook image folder rather than inside it, so both outputs can be produced without colliding
- PDF page size is derived from the rendered image at 226 DPI, so a page whose canvas grew for scrolled content becomes a taller PDF page rather than a cropped one
- A PDF has no WebP filter: when `imageFormat` is `webp`, pages are embedded as JPEG at the configured quality while loose image files stay WebP. This is the only case where a page is rendered twice
- Generated PDFs carry no creation date, modification date, producer or file ID (`updateMetadata: false`), so re-processing an unchanged notebook produces byte-identical output
- Vault writes are skipped entirely when the new bytes match the existing file, for images as well as PDFs. Without this, deterministic output still bumped the mtime on every re-sync and read as a change to Obsidian Sync, Git or Dropbox — a device bumps `lastModified` for benign reasons such as opening a notebook, and automatic sync repeats that on a timer
- Blank pages and pages that failed to render are absent from an assembled PDF, so its page numbers do not necessarily match reMarkable page numbers

## Source-backed documents (imported PDFs and EPUBs)

- A document whose `content.fileType` is `pdf` or `epub` keeps its source blob; it is never discarded. Previously it was downloaded and dropped, so annotated books synced as ink floating on blank pages
- An annotation layer maps to a source page via `cPages[i].redir.value`. Pages inserted on the device carry no `redir` and are given no source page, so their ink is never drawn onto page 0 by default
- With `savePdf` enabled, a source-backed document writes the original through unmodified at `<name>.pdf` and an annotated copy at `<name> (annotated).pdf`. The original is never edited in place
- Page images are never assembled into a PDF for a source-backed document: that would discard the original, which is the defect this rule exists to prevent
- Annotation coordinates map to the page with `scale = cropBox.width / 1872`, x centred on the page and y measured down from the page top. The page width always spans 1872 rm units whatever its real size, so ink legitimately exceeds 1872 in y (an A4 page is 2649 rm units tall). Derived from real exports and confirmed on A4 and US Letter
- Annotating preserves the source document's own metadata (`updateMetadata: false`) and produces byte-identical output across runs
- An encrypted or unreadable source PDF is reported and the original still written through; annotations are not burned in. `ignoreEncryption` is deliberately not used because it succeeds and then produces garbage
- Source PDFs above 80 MB are refused rather than loaded, since the source bytes, the parsed object graph and the output are all live at once
- Text highlights (made by selecting text on the device) are `GlyphRange` items inside `SceneGlyphItemBlock` (0x03) in the `.rm` file, **not** a separate `.highlights` file. They carry the selected text, its colour and its rectangles
- Text highlights are embedded in the annotated PDF as real `/Highlight` annotations with `QuadPoints`, never as painted ink, so a reader can select, display and extract them. The selected text goes in `/Contents`
- A markdown note listing a document's text highlights is written whenever any exist, independent of the PDF toggle, since the text is the device's own record of what was selected
- The device strips the source PDF's line breaks, so highlighted text arrives with joins like "DeviceTrust" and "Backupservers". Only case-transition joins with at least three alphanumeric characters on each side are repaired, bounded to at most one repair per line break (rectangle count minus one). Ambiguous lowercase joins are left intact: without a dictionary "Backupservers" and "Backups ervers" are equally consistent, and corrupting real words is worse than leaving them joined
- EPUB sources are written through but never annotated: the device renders them to its own layout, so there is no page-for-page original to draw on

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
- Icon-only buttons must carry Obsidian's `clickable-icon` class in addition to the plugin's own classes. Obsidian's mobile stylesheet forces a touch-target padding onto every `button:not(.clickable-icon)`, which at 0,2,1 outranks plugin classes and collapses any fixed-width icon button's content box to zero on Android and iPad (issue #19). Use the `ICON_BUTTON_CLASSES` constant rather than repeating the class list
