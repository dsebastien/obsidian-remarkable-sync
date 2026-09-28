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

- A page is skipped only when it has no ink, no text highlight, no typed text and no placed image; testing for strokes alone silently dropped pages written entirely on a keyboard, and later pages holding only a capture
- The plugin supports .rm v6 binary format for stroke data, including the image info (`0x0e`) and image placement (`0x0f`) blocks used by placed images (firmware 3.27+, whether dragged in from the desktop app or made with the 3.28 capture tool)
- Placed images are stored by the device beside their page (`<documentId>/<pageId>/<fileName>`). The placement names the file but not the folder, so the folder is what ties an asset to a page. Asset collection MUST NOT filter by file extension: the .rm file is the authorization, since assets resolve by the exact name the page declared, and an extension allowlist silently drops any format not on it
- Placed images are drawn beneath strokes, so handwriting annotating an image stays on top, and they count toward the page's canvas bounds the same way strokes do
- A .rm block that fails to parse costs that block only. The block length restores the stream, so parsing continues with the next block; a page's remaining content is never discarded because one block was unreadable
- A page that renders nothing MUST NOT be written. Whether an image decodes is only knowable at the draw call, so a page whose only content failed to draw returns no image and counts as a failed page rather than a blank one saved as a success. A page carrying typed text or highlights keeps its blank ink layer, which is correct for it
- An image placement rectangle beyond a generous multiple of the page size is treated as a misparse and ignored, so a bad placement degrades to a page without its capture rather than an allocation that freezes the UI or drops the page
- CRDT text data is parsed: keyboard-typed text is ordered from the sequence and written into a note as text, never drawn into the page image, so it stays searchable and linkable. Handwriting is stroke data and is never converted
- Text ordering happens per **position**, not per item: each item is expanded into one unit per position it claims (counted in code points, not UTF-16 units) before the topological sort. An insertion into the middle of a run anchors both its `leftId` and `rightId` inside the same item, which whole-item ordering read as a cycle and dropped the page's entire text
- An anchor naming a position that does not exist adds no ordering constraint; the unit still sorts by id. Only a genuine cycle (which a well-formed file cannot produce) abandons the page's text

## Sync

- Sync state persists across sessions (stored in plugin data alongside settings)
- A notebook needs syncing when the cloud's CURRENT `lastModified` is greater than the `lastModifiedCloud` recorded at its last sync. Both sides are cloud timestamps: the local clock never takes part, so clock skew cannot affect the decision. `lastSyncedAt` is display only
- A cloud `lastModified` that is not a plain integer is treated as unknown, and an already-synced notebook is left alone rather than re-downloaded on every pass
- "Sync all" only processes notebooks with `needs-sync` or `never-synced` status
- Sync state is cleared when user disconnects from reMarkable cloud
- Users can sync individual notebooks, multiple selected notebooks, or all notebooks at once
- Sync-state entries are pruned ONLY from a cloud listing known to be COMPLETE (`DocumentListing.complete`). A failed or partial listing never prunes: an unreachable cloud returns no notebooks, and reading that as "every notebook was deleted" erases the sync store and forces a full re-download. Generated vault files are never deleted automatically
- A cloud listing reports failure separately from emptiness. "No notebooks" and "could not reach the cloud" are distinct outcomes and must never collapse into the same empty value
- Cloud requests run through a bounded pool (`CLOUD_REQUEST_CONCURRENCY`, 6) for listings and downloads. Mapping every entry into one `Promise.allSettled` fired two requests per document and folder at once
- Transient failures (429, 5xx, network errors) are retried up to `MAX_REQUEST_ATTEMPTS` (4) times, honouring `Retry-After` (seconds or HTTP date) and otherwise with exponential backoff from 1 s; every wait is capped at 30 s. Other 4xx are terminal and never retried
- One failure budget (`RequestBudget`) is shared by every request of a listing or a download. The operation stops making requests after `MAX_CONSECUTIVE_FAILURES` (8) retryable failures in a row (a success resets the count), when a `Retry-After` exceeds the 30 s cap, after `OPERATION_DEADLINE_MS` (10 min), or when the plugin unloads. A stopped listing is incomplete (so never prunes) and reports the stop reason; a stopped download fails
- A root index with any line the parser rejects yields an incomplete listing: the rejected line is an entry that cannot be named, and pruning would read it as deleted
- After a partial refresh the panel keeps the last known entry of every notebook the listing did not return; an entry missing from an incomplete listing is not a deletion. A failed refresh leaves the list untouched
- Entry metadata is cached in memory by the entry's index hash, which changes whenever the entry changes; an unchanged entry is never re-fetched within a session
- A write path is never derived from an incomplete parent chain. If a folder in a notebook's chain is in the index but its metadata could not be read, the notebook is withheld from the listing (which is then incomplete) rather than written to a shortened path in the wrong vault folder. A parent genuinely absent from the index (or deleted) still ends the chain early
- A document download with any blob missing after retries fails as a whole. Processing the rest would mark the notebook synced with pages silently absent, and nothing would retry them
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
- Generated output paths are owned by the plugin. When the bytes differ, the file is REPLACED, including when the difference came from the user editing it: there is no user-modification check, so a hand-annotated generated PDF is lost on the next sync of that notebook. Documented in `docs/usage.md` under "Generated files are overwritten"; renaming a file moves it off a plugin-owned path and protects it permanently
- The write guard compares file CONTENTS, never modification times, so an external touch (another sync tool, a backup job) cannot cause a rewrite and cannot feed back into any sync decision
- Vault writes are skipped entirely when the new bytes match the existing file, for images as well as PDFs. Without this, deterministic output still bumped the mtime on every re-sync and read as a change to Obsidian Sync, Git or Dropbox — a device bumps `lastModified` for benign reasons such as opening a notebook, and automatic sync repeats that on a timer
- Blank pages and pages that failed to render are absent from an assembled PDF, so its page numbers do not necessarily match reMarkable page numbers

## Source-backed documents (imported PDFs and EPUBs)

- A document whose `content.fileType` is `pdf` or `epub` keeps its source blob; it is never discarded. Previously it was downloaded and dropped, so annotated books synced as ink floating on blank pages
- An annotation layer maps to a source page via `cPages[i].redir.value`. Pages inserted on the device carry no `redir` and are given no source page, so their ink is never drawn onto page 0 by default
- With `savePdf` enabled, a source-backed document writes the original through unmodified at `<name>.pdf` and an annotated copy at `<name> (annotated).pdf`. The original is never edited in place
- Page images are never assembled into a PDF for a source-backed document: that would discard the original, which is the defect this rule exists to prevent
- Annotation coordinates map to the page at its true physical size: one rm unit is one screen pixel of the device the document was written on (`pointsPerRmUnit(screen)`), never a fit of the page width to 1872 units. x is centred on the width of the page **as displayed** — under a 90 or 270 degree `/Rotate` that is the crop box's height — and y is measured down from the displayed top. `/Rotate` is normalised into [0, 360) before use, since the specification allows negative multiples of 90
- In both renderers, highlighter ink composites with multiply regardless of its recorded alpha: a v2 highlighter records ARGB alpha 255, and drawing that normally paints an opaque bar over what it was meant to highlight. The shading marker composites normally with its own recorded alpha
- Annotating preserves the source document's own metadata (`updateMetadata: false`) and produces byte-identical output across runs
- An encrypted or unreadable source PDF is reported and the original still written through; annotations are not burned in. `ignoreEncryption` is deliberately not used because it succeeds and then produces garbage
- Source PDFs above 80 MB are refused rather than loaded, since the source bytes, the parsed object graph and the output are all live at once
- Text highlights (made by selecting text on the device) are `GlyphRange` items inside `SceneGlyphItemBlock` (0x03) in the `.rm` file, **not** a separate `.highlights` file. They carry the selected text, its colour and its rectangles
- Text highlights are embedded in the annotated PDF as real `/Highlight` annotations with `QuadPoints`, never as painted ink, so a reader can select, display and extract them. The selected text goes in `/Contents` as a **hex string** (`PDFHexString.fromText`): pdf-lib's `PDFString.of` does no escaping, so an unbalanced parenthesis or backslash corrupted the object and non-ASCII text was mis-decoded
- The markdown note listing a document's text highlights is opt-in via `saveHighlightsNote` (default false) and independent of `savePdf`. It only produces a file for documents that actually contain highlights
- The toggle governs the markdown note only. Text highlights are always embedded in the annotated PDF, since that is part of reproducing the document faithfully rather than an extra output
- The device strips the source PDF's line breaks, so highlighted text arrives with joins like "DeviceTrust" and "Backupservers". Only case-transition joins with at least three alphanumeric characters on each side are repaired, bounded to at most one repair per line break (rectangle count minus one). Ambiguous lowercase joins are left intact: without a dictionary "Backupservers" and "Backups ervers" are equally consistent, and corrupting real words is worse than leaving them joined
- EPUB sources are written through **under their own `.epub` extension** but never annotated: the device renders them to its own layout, so there is no page-for-page original to draw on. Writing the EPUB bytes under a `.pdf` name produced a file no reader could open

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

## Settings

- **Declarative settings pane (Obsidian 1.13+)**: The settings tab is declared via `getSettingDefinitions()` — `display()` never runs, which sets `minAppVersion` to 1.13.0. The old per-section `redisplay` callbacks are dead under this API; every state change that used to redisplay (connect, disconnect, legacy-token removal, visibility-affecting writes) calls `update()` instead.
- **Single serialized write path**: Every settings mutation goes through `updateSettings(recipe)`, which runs INSIDE the same write queue as token writes (`persistData`) — the produce() derives from the previously committed state, the merged `data.json` (settings + sibling token entries) is persisted first, and memory is swapped only after the write lands. A settings save can therefore never clobber a concurrent token refresh, and a failed save rolls the control back to the on-disk truth.
- **`setControlValue` rejects invalid writes**: type mismatches, non-finite or out-of-range numbers, dropdown values outside the declared options, invalid rmfakecloud URLs, and unknown keys all throw. Note the behavior change from the old tab: an invalid rmfakecloud URL used to be persisted (with only a painted error span); it is now refused with the framework's inline error.
