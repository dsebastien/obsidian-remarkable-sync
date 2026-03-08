# Domain Model

## Core Entities

### NotebookSummary

Lightweight representation of a notebook for panel display. Retrieved from cloud listing API.

- `id`, `visibleName`, `parent`, `lastModified`, `pageCount`, `folderPath`

### Notebook

Full notebook with parsed page data. Created after downloading and parsing a document ZIP.

- `id`, `visibleName`, `parent`, `lastModified`, `pageCount`, `pages: Page[]`

### Page

A single page of a notebook containing stroke data.

- `pageId`, `pageIndex`, `strokes: Stroke[]`

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

### SyncStatus (derived)

- `never-synced`: `lastSyncedAt === 0` or no state
- `synced`: `lastSyncedAt >= lastModifiedCloud`
- `needs-sync`: `lastSyncedAt < lastModifiedCloud`

## Settings

### PluginSettings

- `targetFolder`: Vault-relative output path
- `saveImages`: Whether to save rendered PNGs
- `imageFormat`: 'png' | 'jpeg'
- `useRmfakecloud`: Connect to rmfakecloud instead of official cloud
- `rmfakecloudUrl`: Base URL of the rmfakecloud server
- `isAuthenticated`: Derived from token presence
- `syncStore`: Persistent sync state for all notebooks
