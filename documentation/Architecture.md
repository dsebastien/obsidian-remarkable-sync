# Architecture

## Overview

Remarkable Sync is an Obsidian desktop plugin that connects to the reMarkable cloud, downloads notebook pages, and renders them as images.

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

| Service                              | Responsibility                                              |
| ------------------------------------ | ----------------------------------------------------------- |
| `auth/remarkable-auth.service`       | Device registration, token management, auto-refresh         |
| `auth/token-store`                   | Read/write tokens to `~/.remarkable-sync/token.json`        |
| `cloud/remarkable-cloud.service`     | List documents, download files via sync v1.5 protocol       |
| `cloud/sync-protocol`                | Root hash, signed URL blob fetching, index parsing          |
| `parser/rm-file-parser`              | Parse .rm v6 binary format into stroke data                 |
| `parser/document-parser.service`     | Parse document file maps into Notebook structures           |
| `renderer/stroke-renderer`           | Render individual strokes to canvas                         |
| `renderer/page-renderer.service`     | Render full pages to PNG/JPEG                               |
| `output/markdown-writer.service`     | Save images to vault                                        |
| `pipeline/notebook-pipeline.service` | Per-notebook orchestrator: download → parse → render → save |
| `sync/sync-store.service`            | Sync state persistence via plugin data                      |

### UI

| Component                  | Type               | Purpose                                           |
| -------------------------- | ------------------ | ------------------------------------------------- |
| `RemarkablePanelView`      | `ItemView`         | Sidebar panel listing notebooks with actions      |
| `AuthModal`                | `Modal`            | Device code entry for authentication              |
| `RemarkableSyncSettingTab` | `PluginSettingTab` | Plugin settings with auth, output, about sections |

### Commands

| Command ID                     | Action                                          |
| ------------------------------ | ----------------------------------------------- |
| `remarkable-open-panel`        | Opens the sidebar panel                         |
| `remarkable-connect-device`    | Opens auth modal                                |
| `remarkable-disconnect-device` | Clears tokens and disconnects                   |
| `remarkable-list-notebooks`    | Lists all notebooks via Notice                  |
| `remarkable-sync-notebook`     | Fuzzy-search picker to sync a specific notebook |

## Data Flow

### Download

```
Panel click → Pipeline → Sync protocol (root hash → signed URL → blobs) → Parse file map → Parse .rm files → Render pages → Save images to vault → Update sync state
```

## External Dependencies

- **reMarkable cloud sync v1.5 API**: Root hash, signed URL blob downloads, index tree walking
- **JSZip**: ZIP extraction (utility, not used in main sync flow)
- **OffscreenCanvas**: Page rendering (Electron/desktop only)
