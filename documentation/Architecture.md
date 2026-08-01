# Architecture

## Overview

Remarkable Synchronizer is an Obsidian desktop plugin that connects to the reMarkable cloud (or a self-hosted rmfakecloud server), downloads notebook pages, and renders them as images.

## Layers

```
Commands & UI (commands/, ui/)
    ↓
Plugin Core (plugin.ts)
    ↓
Pipeline Service (pipeline/)
    ↓
Domain Services (auth/, cloud/, parser/, renderer/, output/)
    ↓
Utilities (utils/)
    ↓
Domain Types (domain/)
```

## Key Components

### Plugin (`src/app/plugin.ts`)

- Entry point for Obsidian lifecycle
- Initializes services, registers commands, view, ribbon icon, settings tab
- Manages plugin settings via Immer immutable pattern

### Services

| Service                              | Responsibility                                                          |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `auth/remarkable-auth.service`       | Device registration, token management, auto-refresh                     |
| `auth/token-store`                   | Read/write tokens to `~/.remarkable-sync/token.json`                    |
| `cloud/cloud-urls`                   | Resolve auth/sync base URLs based on settings (official vs rmfakecloud) |
| `cloud/remarkable-cloud.service`     | List documents, download files via sync v1.5 protocol                   |
| `cloud/sync-protocol`                | Root hash, signed URL blob fetching, index parsing                      |
| `parser/rm-file-parser`              | Parse .rm v6 binary format into stroke data                             |
| `parser/document-parser.service`     | Parse file maps into Notebooks; keeps the source PDF/EPUB and page map  |
| `renderer/stroke-renderer`           | Render individual strokes to canvas                                     |
| `renderer/page-renderer.service`     | Render full pages to PNG/JPEG                                           |
| `output/markdown-writer.service`     | Save images and PDFs to vault; skips writes whose bytes are unchanged   |
| `output/pdf-writer.service`          | Build a PDF from rendered pages (pdf-lib), deterministic output         |
| `output/pdf-coordinates`             | Map .rm stroke coordinates onto a source PDF page (pure functions)      |
| `output/pdf-annotator.service`       | Draw ink and embed text highlights onto the source PDF                  |
| `output/highlights-markdown`         | Build a markdown note from a document's text highlights                 |
| `output/document-output.service`     | Shared render-and-write loop for cloud sync and .rmdoc import           |
| `pipeline/notebook-pipeline.service` | Per-notebook orchestrator: download → parse → render → save             |
| `sync/sync-store.service`            | Sync state persistence via plugin data; prunes orphaned entries         |
| `sync/auto-sync.service`             | Opt-in background sync timer (guards: disconnected, overlapping runs)   |
| `import/rmdoc-import.service`        | Import local .rmdoc files: extract ZIP → parse → render → save          |

### UI

| Component                  | Type               | Purpose                                                             |
| -------------------------- | ------------------ | ------------------------------------------------------------------- |
| `RemarkablePanelView`      | `ItemView`         | Sidebar panel listing notebooks with actions                        |
| `AuthModal`                | `Modal`            | Device code entry for authentication                                |
| `ImportConfirmModal`       | `Modal`            | Confirmation dialog before .rmdoc file import                       |
| `RemarkableSyncSettingTab` | `PluginSettingTab` | Plugin settings with auth, cloud, sync, output, PDF, about sections |

### Commands

| Command ID                     | Action                                          |
| ------------------------------ | ----------------------------------------------- |
| `remarkable-open-panel`        | Opens the sidebar panel                         |
| `remarkable-connect-device`    | Opens auth modal                                |
| `remarkable-disconnect-device` | Clears tokens and disconnects                   |
| `remarkable-list-notebooks`    | Lists all notebooks via Notice                  |
| `sync-notebook`                | Fuzzy-search picker to sync a specific notebook |
| `remarkable-import-rmdoc`      | Import a local .rmdoc file via file browser     |

## Data Flow

### Cloud Sync

```
Panel click → Pipeline → Sync protocol (root hash → signed URL → blobs) → Parse file map → Parse .rm files → Render pages → Save images to vault → Update sync state
```

### Local Import

```
Command/Panel button → File browser → Confirm modal → Extract ZIP (fflate) → Parse file map → Parse .rm files → Render pages → Save images to vault
```

## External Dependencies

- **reMarkable cloud sync v1.5 API** (or rmfakecloud): Root hash, signed URL blob downloads, index tree walking
- **fflate**: ZIP extraction for .rmdoc import. Imported as `fflate/browser` — the default (`node`) entry point begins with a top-level `require("module")`/`worker_threads`, which throws on mobile. `unzipSync` deliberately, since the async variant pulls in worker machinery
- **pdf-lib**: PDF generation for the `savePdf` output, and the basis for future work on PDF-backed documents. Measured at ~505 KB bundled under Bun with production settings, taking `dist/main.js` from 145 KB to 665 KB. A deliberate, documented exception to the small-dependency guidance: authoring an image-only PDF is small, but reading and modifying an existing one means parsing cross-reference streams and object streams, which is a real PDF reader. Adds no `require()`, no worker and no blob URL to the bundle
- **OffscreenCanvas**: Page rendering. Available in Electron and in Android's webview; needs iOS 16.4+ on iPhone/iPad. `isPageRenderingSupported()` gates both the sync pipeline and .rmdoc import so an unsupported device reports a clear message instead of a generic render failure
