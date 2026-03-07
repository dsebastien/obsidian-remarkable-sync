# Usage

## Getting Started

1. Install the plugin from Community Plugins (or manually copy build artifacts)
2. Enable the plugin in **Settings → Community plugins**
3. Connect to your reMarkable account (see below)

## Authentication

1. Run the **"Connect to reMarkable cloud"** command (Ctrl/Cmd+P → type "Connect")
2. In the modal, follow the link to [my.remarkable.com/device/desktop/connect](https://my.remarkable.com/device/desktop/connect)
3. Sign in with your reMarkable account
4. Copy the 8-character one-time code
5. Paste it into the plugin modal and click **Connect**

Your device token is stored at `~/.remarkable-sync/token.json` and persists across sessions.

## Commands

| Command                          | Description                             |
| -------------------------------- | --------------------------------------- |
| Open reMarkable panel            | Opens the sidebar listing all notebooks |
| Connect to reMarkable cloud      | Opens the authentication modal          |
| Disconnect from reMarkable cloud | Clears stored tokens                    |
| Import .rmdoc file               | Import a local .rmdoc file as images    |

## Using the Panel

The panel shows all your reMarkable notebooks grouped by folder. Each notebook has a download action button.

- **Download** (download icon) — downloads and renders page images
- **Import** (import icon) — import a local .rmdoc file (always available, no cloud connection needed)

Progress is shown inline per notebook: downloading → parsing → rendering → done.

Use the **refresh** button at the top to re-fetch the notebook list from the cloud.

## Importing .rmdoc Files

You can import `.rmdoc` files exported from a reMarkable tablet without needing a cloud connection. This is useful for processing files shared by others or exported manually.

1. Run the **"Import .rmdoc file"** command (Ctrl/Cmd+P → type "Import"), or click the **import** button in the panel header
2. Select a `.rmdoc` file from your file system
3. Review the file name and target folder in the confirmation dialog
4. Click **Import** to process the file

The notebook name is taken from the document metadata if available, otherwise from the file name. Images are saved to the configured target folder.

## Output

Files are saved to your configured target folder (default: vault root), preserving the reMarkable folder hierarchy for cloud-synced notebooks. Imported .rmdoc files are saved directly under the target folder.

Each page with content produces:

- `{NotebookName}-P{NNN}.png` — rendered page image (if "Save images" is enabled)

Blank pages (no strokes) are skipped entirely.
