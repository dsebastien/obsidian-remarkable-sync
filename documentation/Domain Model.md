# Domain Model

## Core Entities

### NotebookSummary

Lightweight representation of a notebook for panel display. Retrieved from cloud listing API.

- `id`, `visibleName`, `parent`, `lastModified`, `pageCount`, `folderPath`

### Notebook

Full notebook with parsed page data. Created after downloading and parsing a document ZIP.

- `id`, `visibleName`, `parent`, `lastModified`, `pageCount`, `pages: Page[]`, `sourceDocument?`

### Page

A single page of a notebook containing stroke data.

- `pageId`, `pageIndex`, `strokes: Stroke[]`
- `images?`: placed images. Absent on pages that have none, which is every page written before firmware 3.27
- `sourcePageIndex?`: index of the source-document page this layer annotates. Absent for notebook pages and for pages inserted on the device
- `highlights?`: text highlights on this page, present only on source-backed documents

### Highlight

Text highlighted by selecting it on the device, as opposed to ink drawn with the highlighter pen. Parsed from `SceneGlyphItemBlock` in the `.rm` file.

- `text`: the selected text, exactly as the device recorded it
- `color: StrokeColor`, `rects: HighlightRect[]` (one rectangle per highlighted line)

### SourceDocument

The original file a document was imported from, retained so annotations can be drawn back onto it.

- `kind: 'pdf' | 'epub'`, `data: ArrayBuffer`

### PageImage

An image placed on a page, either dragged in from the desktop app (firmware 3.27, "Add images to notebooks", jpg or png) or made with the capture tool (firmware 3.28). Both write the same blocks. The device stores the pixels
beside the page (`<documentId>/<pageId>/<fileName>`) and records only the placement in the .rm
file, so the folder is what ties an asset to a page.

- `assetId` (16 bytes as lowercase hex, carried for diagnostics), `fileName`, `x`, `y`, `width`, `height`
- `data: ArrayBuffer | null` — image bytes, null when the file was absent from the archive

Known gaps:

- **Rotated and cropped placements render wrong.** The placement is a quad of four `(x, y, u, v)`
  vertices; the renderer reduces it to a bounding box and ignores the uv half, so a rotated or
  cropped capture draws upright and uncropped. The parser warns when the quad is not canonical.
  No sample with a rotated placement exists yet.
- **The per-declaration flags are ignored.** Observed as `[17, 0]` in every sample; meaning unknown.
- **The cloud sync path is unverified for assets.** All capture verification so far is through
  .rmdoc import. `IndexEntry.subfiles` is parsed but read nowhere, so if the v3 sync index nests
  the per-page asset folder rather than listing it flat, assets will not download and capture-only
  pages will still be dropped.

### Stroke

A single pen stroke drawn on a page.

- `penType: PenType`, `color: StrokeColor`, `thickness`, `points: StrokePoint[]`

### StrokePoint

A single point within a stroke with pressure/velocity data.

- `x`, `y`, `speed`, `width`, `direction`, `pressure`

## Enumerations

### PenType

18 pen types including BallPoint, Marker, Fineliner, Pencil variants, Brush, Highlighter, Eraser, CalligraphyPen.

### StrokeColor

9 colors: Black, Grey, White, Yellow, Green, Pink, Blue, Red, GreyOverlap.

## Cloud Types

### RemarkableCloudEntry

Entry from cloud document index: `id`, `hash`, `type`, `visibleName`, `parent`, `lastModified`, `version`.

### RemarkableDocumentMetadata / RemarkableDocumentContent

Metadata and content JSON files found inside document ZIP archives.

## Sync State

### NotebookSyncState

Per-notebook sync metadata persisted in plugin data.

- `remarkableId`: Notebook ID from reMarkable cloud
- `lastSyncedAt`: Epoch ms of last successful sync (0 = never synced)
- `lastModifiedCloud`: Epoch ms of cloud modification timestamp at sync time
- `syncedPageCount`: Number of pages synced

### SyncStore

Top-level container: `notebooks: Record<string, NotebookSyncState>` keyed by remarkableId.

Entries whose notebook is no longer present in a fresh cloud listing are orphaned and pruned (`findOrphanedSyncIds` + `SyncStoreService.pruneMissing`) on panel refresh and automatic sync runs. Vault files are never removed by pruning.

### SyncStatus (derived)

- `never-synced`: `lastSyncedAt === 0` or no state
- `synced`: `lastSyncedAt >= lastModifiedCloud`
- `needs-sync`: `lastSyncedAt < lastModifiedCloud`

## Settings

### PluginSettings

- `targetFolder`: Vault-relative output path
- `saveImages`: Whether to save rendered page images
- `savePdf`: Whether to write one PDF per notebook (default false), independent of `saveImages`
- `saveHighlightsNote`: Whether to write a markdown note of a document's text highlights (default false)
- `imageFormat`: 'png' | 'jpeg'
- `useRmfakecloud`: Connect to rmfakecloud instead of official cloud
- `rmfakecloudUrl`: Base URL of the rmfakecloud server
- `autoSyncEnabled`: Opt-in automatic background sync (default false)
- `autoSyncIntervalMinutes`: Minutes between automatic syncs (clamped 5–240, default 30)
- `panelSortOrder`: How the panel orders notebooks (`modified-desc` default, plus `modified-asc`, `name-asc`, `name-desc`)
- `isAuthenticated`: Derived from token presence
- `syncStore`: Persistent sync state for all notebooks
