# Usage

## Getting Started

1. Install the plugin from Community Plugins (or manually copy build artifacts)
2. Enable the plugin in **Settings → Community plugins**
3. Connect to your reMarkable account (see below)

## Authentication

### Official reMarkable cloud

1. Run the **"Connect to reMarkable cloud"** command (Ctrl/Cmd+P → type "Connect")
2. In the modal, follow the link to [my.remarkable.com/device/desktop/connect](https://my.remarkable.com/device/desktop/connect)
3. Sign in with your reMarkable account
4. Copy the 8-character one-time code
5. Paste it into the plugin modal and click **Connect**

### rmfakecloud

1. Enable **"Use rmfakecloud"** in **Settings → Community plugins → Remarkable Sync → Cloud**
2. Enter your rmfakecloud server URL (e.g., `https://cloud.example.com`)
3. Run the **"Connect to reMarkable cloud"** command
4. Open your rmfakecloud web interface and generate a one-time code
5. Enter the code in the plugin modal and click **Connect**

Your device token is stored at `~/.remarkable-sync/token.json` and persists across sessions.

## Commands

| Command                          | Description                                  |
| -------------------------------- | -------------------------------------------- |
| Open reMarkable panel            | Opens the sidebar listing all notebooks      |
| Connect to reMarkable cloud      | Opens the authentication modal               |
| Disconnect from reMarkable cloud | Clears stored tokens                         |
| List notebooks                   | Fetches and lists notebooks from the cloud   |
| Sync a notebook                  | Syncs a single notebook chosen from a prompt |
| Import .rmdoc file               | Import a local .rmdoc file as images         |

## Using the Panel

The panel shows all your reMarkable notebooks grouped by folder. A connection status indicator at the top shows whether you are connected to the cloud.

### Header actions

- **Import** (import icon) — import a local `.rmdoc` file (always available, no cloud connection needed)
- **Sync all** (refresh icon with slash) — syncs all notebooks that need updating (have `needs-sync` or `never-synced` status)
- **Sync selected** — appears when notebooks are selected; syncs only the checked notebooks
- **Refresh** (refresh icon) — re-fetches the notebook list from the cloud

### Searching and filtering

- **Search** — a fuzzy search box filters notebooks by name and folder path
- **Filter buttons** — toggle between **All**, **Selected**, and **Unselected** to narrow the list

### Notebook list

Each notebook row shows:

- **Checkbox** — select notebooks for bulk sync
- **Sync status dot** — colored indicator showing sync state:
    - **Synced** — local copy is up to date
    - **Needs sync** — cloud version is newer than the local copy
    - **Never synced** — notebook has never been synced locally
- **Notebook name** and last-modified date
- **Sync button** — syncs that individual notebook

A **Select all** checkbox at the top operates on the currently filtered notebooks.

Progress is shown inline per notebook: downloading → parsing → rendering → done.

## Importing .rmdoc Files

You can import `.rmdoc` files exported from a reMarkable tablet without needing a cloud connection. This is useful for processing files shared by others or exported manually.

1. Run the **"Import .rmdoc file"** command (Ctrl/Cmd+P → type "Import"), or click the **import** button in the panel header
2. Select a `.rmdoc` file from your file system
3. Review the file name and target folder in the confirmation dialog
4. Click **Import** to process the file

The notebook name is taken from the document metadata if available, otherwise from the file name. Images are saved to the configured target folder (not grouped by folder hierarchy).

## Output

Files are saved to your configured target folder (default: vault root), preserving the reMarkable folder hierarchy for cloud-synced notebooks. Imported `.rmdoc` files are saved directly under the target folder.

Each page with content produces an image file:

- `{NotebookName}-P{NNN}.{ext}` — rendered page image (if "Save images" is enabled)

The file extension matches your configured image format (`.jpeg` by default, or `.png`/`.webp`).

Blank pages (no strokes) are skipped entirely.
