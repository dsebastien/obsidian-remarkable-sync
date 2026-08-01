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
- `sourcePageIndex?`: index of the source-document page this layer annotates. Absent for notebook pages and for pages inserted on the device
- `highlights?`: text highlights on this page, present only on source-backed documents

### Highlight

Text highlighted by selecting it on the device, as opposed to ink drawn with the highlighter pen. Parsed from `SceneGlyphItemBlock` in the `.rm` file.

- `text`: the selected text, exactly as the device recorded it
- `color: StrokeColor`, `rects: HighlightRect[]` (one rectangle per highlighted line)

### SourceDocument

The original file a document was imported from, retained so annotations can be drawn back onto it.

- `kind: 'pdf' | 'epub'`, `data: ArrayBuffer`

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
- `imageFormat`: 'png' | 'jpeg'
- `useRmfakecloud`: Connect to rmfakecloud instead of official cloud
- `rmfakecloudUrl`: Base URL of the rmfakecloud server
- `autoSyncEnabled`: Opt-in automatic background sync (default false)
- `autoSyncIntervalMinutes`: Minutes between automatic syncs (clamped 5–240, default 30)
- `isAuthenticated`: Derived from token presence
- `syncStore`: Persistent sync state for all notebooks
