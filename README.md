# Remarkable Synchronizer

An Obsidian plugin that connects to the reMarkable cloud to list, download, and sync notebook pages as images.

## Features

- **reMarkable cloud integration** — connect with a one-time code, list all notebooks
- **rmfakecloud support** — connect to a self-hosted [rmfakecloud](https://github.com/ddvk/rmfakecloud) server as an alternative to the official cloud
- **Page rendering** — render .rm v6 stroke data to PNG/JPEG images
- **Sidebar panel** — browse notebooks with foldable folder hierarchy, search, multi-select, and per-notebook download
- **Folder hierarchy preservation** — reMarkable folder structure mirrored in vault
- **PDF export** — one PDF per notebook, beside the page images, behind an off-by-default toggle
- **Annotated PDFs** — documents imported onto the device sync back as the original PDF plus a copy with your handwriting drawn on it, text still selectable
- **Text highlights** — highlights made on the device become real PDF highlight annotations, with an optional markdown note quoting them
- **Typed text** — keyboard-typed text becomes a searchable markdown note; `[[wikilinks]]` typed on the device become real links
- **Local .rmdoc import** — import .rmdoc files directly without cloud connection
- **Automatic sync** — optional background sync of all notebooks that need updating, on a configurable interval (off by default)
- **What's new after updates.** After a plugin update, a one-time dialog shows the release notes you just received (including skipped versions) with ways to support development. Never shown on fresh installs or regular restarts.

## Requirements

- Obsidian v1.13.0+
- Desktop is fully supported. **Mobile support is experimental** — see [Mobile](#mobile).
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

| Setting              | Default     | Description                                                                  |
| -------------------- | ----------- | ---------------------------------------------------------------------------- |
| Target folder        | `""` (root) | Vault folder for output files                                                |
| Save images          | `true`      | Save rendered page images                                                    |
| Save as PDF          | `false`     | One PDF per notebook; for imported PDFs, the original plus an annotated copy |
| Save highlights note | `false`     | Markdown note of text highlighted on the device                              |
| Save typed text note | `false`     | Markdown note of text typed on the device's keyboard                         |
| Image format         | `jpeg`      | JPEG, WebP or PNG                                                            |
| Use rmfakecloud      | `false`     | Connect to a self-hosted rmfakecloud server instead of official cloud        |
| Server URL           | `""`        | Base URL of your rmfakecloud server (only when rmfakecloud is enabled)       |

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

## Mobile

Mobile support is **experimental** and needs testing on real devices. Please report what you find.

- **Android** works, though it is still unconfirmed on real hardware. The panel's icon buttons rendered blank on tablets in 1.14.0; fixed in 1.15.0.
- **iPhone / iPad** need iOS 16.4 or later. Page rendering uses `OffscreenCanvas`; on older versions the plugin tells you rather than silently producing empty notebooks.
- Automatic background sync stays off by default. Turning it on will use mobile data and battery.
- Importing a `.rmdoc` file relies on the system file picker, which may not offer `.rmdoc` files on iOS.

If something does not work, please open an issue and include your device, OS version, and what you saw.

## Privacy

- Authentication tokens are stored in the plugin's own `data.json`, inside `.obsidian/plugins/remarkable-synchronizer/`. They are **not** part of the plugin settings, so they never appear in the debug log or in a settings export.
- Because they live in the vault, anything that syncs `.obsidian` syncs them too — Obsidian Sync's _community plugin settings_ option, or a vault tracked in Git or a cloud folder. Exclude `.obsidian/plugins/remarkable-synchronizer/data.json` if you do not want your reMarkable credentials to travel with your vault.
- Tokens are per-vault. Earlier desktop versions stored a single machine-wide `~/.remarkable-sync/token.json`; that file is imported automatically on first run and then left untouched. Remove it from **Settings → Remarkable Synchronizer → Legacy token file** once all your vaults are on this version.
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

<!-- other-plugins:start -->

## My other Obsidian plugins

| Plugin                                                                                                        | What it does                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Agentic Resource Discovery Server](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server) | Local-first Agentic Resource Discovery publisher and registry that serves your AI skills and tools to agents over a local HTTP and MCP server |
| [Book Exporter](https://github.com/dsebastien/obsidian-book-exporter)                                         | Export books (one manifest note + linked chapter notes) to EPUB and PDF via Pandoc                                                            |
| [Bookshelf Base](https://github.com/dsebastien/obsidian-bookshelf)                                            | Display your notes as a visual bookshelf via a custom Bases view                                                                              |
| [Dataview Serializer](https://github.com/dsebastien/obsidian-dataview-serializer)                             | Serialize Dataview queries to Markdown, and keep the Markdown representation up to date                                                       |
| [Expander](https://github.com/dsebastien/obsidian-expander)                                                   | Replace variables across your vault using HTML comment markers. Supports static values and dynamic functions                                  |
| [Ghost Publish](https://github.com/dsebastien/obsidian-ghost-publish)                                         | Publish your vault notes to a Ghost blog with configurable presets for tags, newsletters, and frontmatter conventions                         |
| [Graph Explorer Base View](https://github.com/dsebastien/obsidian-graph-explorer-base-view)                   | A custom Bases view that renders notes as an interactive force-directed graph with explored/unexplored tracking                               |
| [Hidden Folders Access](https://github.com/dsebastien/obsidian-hidden-folders-access)                         | Index hidden root-level folders (e.g. .claude) so they appear in the file tree, metadata cache, and Bases                                     |
| [Journal Bases](https://github.com/dsebastien/obsidian-journal-base)                                          | Custom Base views for journaling and periodic reviews                                                                                         |
| [Kanban Action Planner](https://github.com/dsebastien/obsidian-kanban-action-planner)                         | Render your notes as configurable Kanban boards and calendars inside Bases, with statuses, ordering, relationships, and scheduling            |
| [Life Tracker](https://github.com/dsebastien/obsidian-life-tracker-base-view)                                 | Capture and visualize the data that matters in your life                                                                                      |
| [Note Village](https://github.com/dsebastien/obsidian-note-village)                                           | A 2D pixel art village where your notes become villagers you can explore and chat with using AI                                               |
| [Obsidian Starter Kit](https://github.com/DeveloPassion/obsidian-starter-kit-plugin)                          | Adds strong typing support and powerful automation support for notes                                                                          |
| [Replicate](https://github.com/dsebastien/obsidian-replicate)                                                 | Use AI models with ease via the Replicate.com integration                                                                                     |
| [REST and MCP server](https://github.com/dsebastien/obsidian-cli-rest)                                        | Exposes CLI commands as RESTful API endpoints and an MCP server for AI tool integration                                                       |
| [Time Machine](https://github.com/dsebastien/obsidian-time-machine)                                           | Browse, compare, and restore previous versions of your notes using built-in file-recovery snapshots                                           |
| [Transcriber](https://github.com/dsebastien/obsidian-transcriber)                                             | Transcribe images to markdown using Ollama vision models                                                                                      |
| [Typefully](https://github.com/dsebastien/obsidian-typefully)                                                 | Publish social media posts with ease using the Typefully integration                                                                          |
| [Update Time](https://github.com/dsebastien/obsidian-update-time)                                             | Automatically update front matter to include creation and last update times                                                                   |

Everything I build is documented in [my newsletter](https://dsebastien.net/newsletter) and on [my YouTube channel](https://youtube.com/@dsebastien).
<!-- other-plugins:end -->

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
