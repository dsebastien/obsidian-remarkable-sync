# Remarkable Synchronizer

An Obsidian plugin that connects to the reMarkable cloud to list, download, and sync notebook pages as images.

## Features

- **reMarkable cloud integration** — connect with a one-time code, list all notebooks
- **rmfakecloud support** — connect to a self-hosted [rmfakecloud](https://github.com/ddvk/rmfakecloud) server as an alternative to the official cloud
- **Page rendering** — render .rm v6 stroke data to PNG/JPEG images
- **Sidebar panel** — browse notebooks with foldable folder hierarchy, search, multi-select, and per-notebook download
- **Folder hierarchy preservation** — reMarkable folder structure mirrored in vault
- **Local .rmdoc import** — import .rmdoc files directly without cloud connection
- **Automatic sync** — optional background sync of all notebooks that need updating, on a configurable interval (off by default)
- **What's new after updates.** After a plugin update, a one-time dialog shows the release notes you just received (including skipped versions) with ways to support development. Never shown on fresh installs or regular restarts.

## Requirements

- Obsidian (desktop only, v1.4.0+)
- A reMarkable account with cloud sync enabled, or a [rmfakecloud](https://github.com/ddvk/rmfakecloud) server (optional for local .rmdoc import)

## Installation

### Community plugins (recommended)

1. In Obsidian, go to **Settings → Community plugins**.
2. Disable **Restricted mode** if it's enabled.
3. Select **Browse**, search for **Remarkable Synchronizer**, install it, then enable it.

You can also browse the catalog on the [Obsidian Community](https://community.obsidian.md/) website.

### Manual installation

If the plugin isn't listed in the community catalog yet (or you want a specific version):

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/dsebastien/obsidian-remarkable-sync/releases).
2. Copy them into `<Vault>/.obsidian/plugins/remarkable-synchronizer/`.
3. Reload Obsidian and enable **Remarkable Synchronizer** in **Settings → Community plugins**.

### BRAT (bleeding edge)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewers Auto-update Tool) installs plugins straight from a GitHub repo and keeps them updated automatically. Use this if you want the latest commits — **things might break**.

1. Install **Obsidian42 - BRAT** from **Settings → Community plugins → Browse** and enable it.
2. Run **BRAT: Add a beta plugin for testing** from the command palette.
3. Paste `https://github.com/dsebastien/obsidian-remarkable-sync`.
4. Select the latest version and confirm.
5. Enable **Remarkable Synchronizer** in **Settings → Community plugins**.

## Quick Start

1. Install the plugin (see [Installation](#installation) above).
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

| Setting         | Default     | Description                                                            |
| --------------- | ----------- | ---------------------------------------------------------------------- |
| Target folder   | `""` (root) | Vault folder for output files                                          |
| Save images     | `true`      | Save rendered page images                                              |
| Image format    | `png`       | PNG or JPEG                                                            |
| Use rmfakecloud | `false`     | Connect to a self-hosted rmfakecloud server instead of official cloud  |
| Server URL      | `""`        | Base URL of your rmfakecloud server (only when rmfakecloud is enabled) |

## Output Format

Page images are saved as: `{NotebookName}-P{NNN}.png`

Folder hierarchy is preserved:

```
{targetFolder}/Work/Meeting Notes/Meeting Notes-P001.png
```

Blank pages (no strokes) are skipped.

## rmfakecloud

This plugin supports [rmfakecloud](https://github.com/ddvk/rmfakecloud), a self-hosted reMarkable cloud replacement. To use it:

1. Enable **"Use rmfakecloud"** in plugin settings
2. Enter your rmfakecloud server URL (e.g., `https://cloud.example.com`)
3. Run **"Connect to reMarkable cloud"** and enter a one-time code generated from your rmfakecloud web interface

The authentication flow and sync protocol are identical to the official cloud. All API requests go to your self-hosted server instead of reMarkable's servers.

## Privacy

- Authentication tokens are stored at `~/.remarkable-sync/token.json`, deliberately **outside the vault**. This keeps long-lived reMarkable credentials out of any vault sync/sharing (e.g. Obsidian Sync, Git, cloud folders) so they are never accidentally distributed alongside notes. This is the only file the plugin reads or writes outside the vault, and is why the plugin is desktop-only.
- No telemetry or third-party analytics
- Network requests only to reMarkable cloud (or your rmfakecloud server when enabled)

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for development instructions.

```bash
bun install
bun run dev
```

## License

MIT License - see [LICENSE](./LICENSE) for details.

<!-- support-cta -->
## News & support

To stay up to date about this plugin, Obsidian in general, Personal Knowledge Management and note-taking:

- Subscribe to [my newsletter](https://dsebastien.net/newsletter)
- Subscribe to [my YouTube channel](https://youtube.com/@dsebastien)
- Join the [Knowii community](https://www.store.dsebastien.net/product/knowii-community/) and learn to organize your notes and put your knowledge to work, together with fellow knowledge workers

If this plugin is useful to you, here are the best ways to support my work ❤️:

- [Join the Knowii community](https://www.store.dsebastien.net/product/knowii-community/)
- [Become a GitHub Sponsor](https://github.com/sponsors/dsebastien)
- [Buy me a coffee](https://www.buymeacoffee.com/dsebastien)
- [Subscribe to my YouTube channel](https://youtube.com/@dsebastien)
- [Check out my products](https://store.dsebastien.net)

Found a bug or have an idea? [Open an issue](https://github.com/dsebastien/obsidian-remarkable-sync/issues).
