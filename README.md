# Remarkable Sync

An Obsidian plugin that connects to the reMarkable cloud to list, download, and sync notebook pages as images.

## Features

- **reMarkable cloud integration** — connect with a one-time code, list all notebooks
- **Page rendering** — render .rm v6 stroke data to PNG/JPEG images
- **Sidebar panel** — browse notebooks with folder hierarchy, download per notebook
- **Folder hierarchy preservation** — reMarkable folder structure mirrored in vault
- **Local .rmdoc import** — import .rmdoc files directly without cloud connection

## Requirements

- Obsidian (desktop only, v1.4.0+)
- A reMarkable account with cloud sync enabled (optional for local .rmdoc import)

## Quick Start

1. Install the plugin from Community Plugins
2. Run **"Connect to reMarkable cloud"** command
3. Enter your one-time code from [my.remarkable.com](https://my.remarkable.com/device/desktop/connect)
4. Run **"Open reMarkable panel"** to browse notebooks
5. Click the download button on any notebook

## Commands

| Command                          | Description                               |
| -------------------------------- | ----------------------------------------- |
| Open reMarkable panel            | Opens the sidebar panel listing notebooks |
| Connect to reMarkable cloud      | Opens the authentication modal            |
| Disconnect from reMarkable cloud | Clears stored tokens                      |
| Import .rmdoc file               | Import a local .rmdoc file as images      |

## Settings

| Setting       | Default     | Description                   |
| ------------- | ----------- | ----------------------------- |
| Target folder | `""` (root) | Vault folder for output files |
| Save images   | `true`      | Save rendered page images     |
| Image format  | `png`       | PNG or JPEG                   |

## Output Format

Page images are saved as: `{NotebookName}-P{NNN}.png`

Folder hierarchy is preserved:

```
{targetFolder}/Work/Meeting Notes/Meeting Notes-P001.png
```

Blank pages (no strokes) are skipped.

## Privacy

- Authentication tokens stored at `~/.remarkable-sync/token.json` (outside vault)
- No telemetry or third-party analytics
- Network requests only to reMarkable cloud

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for development instructions.

```bash
bun install
bun run dev
```

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Support

Created by [Sébastien Dubois](https://dsebastien.net). [Buy me a coffee](https://www.buymeacoffee.com/dsebastien) to support development.
