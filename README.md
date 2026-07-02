# Remarkable Synchronizer

An Obsidian plugin that connects to the reMarkable cloud to list, download, and sync notebook pages as images.

## Features

- **reMarkable cloud integration** — connect with a one-time code, list all notebooks
- **rmfakecloud support** — connect to a self-hosted [rmfakecloud](https://github.com/ddvk/rmfakecloud) server as an alternative to the official cloud
- **Page rendering** — render .rm v6 stroke data to PNG/JPEG images
- **Sidebar panel** — browse notebooks with foldable folder hierarchy, search, multi-select, and per-notebook download
- **Folder hierarchy preservation** — reMarkable folder structure mirrored in vault
- **Local .rmdoc import** — import .rmdoc files directly without cloud connection
- **Sync log panel** — a live sidebar view of sync + OCR activity, with failures and their reason

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

| Command                          | Description                                            |
| -------------------------------- | ------------------------------------------------------ |
| Open reMarkable panel            | Opens the sidebar panel listing notebooks              |
| Open reMarkable sync log         | Opens the sidebar panel of live sync + OCR activity    |
| Connect to reMarkable cloud      | Opens the authentication modal                         |
| Disconnect from reMarkable cloud | Clears stored tokens                                   |
| Import .rmdoc file               | Import a local .rmdoc file as images                   |
| Fix OCR image links in notes     | Repoint broken OCR figure links to the real page image |

### Sync log

The **reMarkable sync log** is a sidebar view (open it via the command above or the
log button on the notebook panel) showing a live, chronological feed of sync and OCR
activity — each run's trigger (startup / interval / manual), per-page OCR outcomes
(✓ transcribed, ⊘ unchanged, ✗ failed **with the failure reason**, e.g. an HTTP 429
rate-limit), and per-notebook summaries. It keeps the most recent ~200 events in
memory (not persisted) and has a **Clear** button. Useful for seeing _why_ a sync
stalled without digging through the developer console.

## Settings

| Setting                      | Default                     | Description                                                                                                                  |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Target folder                | `""` (root)                 | Vault folder for output files                                                                                                |
| Save images                  | `true`                      | Save rendered page images                                                                                                    |
| Image format                 | `png`                       | PNG or JPEG                                                                                                                  |
| Use rmfakecloud              | `false`                     | Connect to a self-hosted rmfakecloud server instead of official cloud                                                        |
| Server URL                   | `""`                        | Base URL of your rmfakecloud server (only when rmfakecloud is enabled)                                                       |
| Transcribe pages to markdown | `false`                     | Send each new/changed synced page to a **local** OCR server and assemble one markdown note per notebook (newest page on top) |
| OCR server URL               | `http://localhost:1250/ocr` | Endpoint the page image is posted to (only when transcription is enabled)                                                    |
| OCR request delay (ms)       | `400`                       | Pause between per-page OCR requests to stay under the OCR provider's rate limit (0 disables)                                 |

### OCR transcription

When **Transcribe pages to markdown** is enabled, each new or changed synced page
image is posted to the local OCR server (default `http://localhost:1250/ocr`),
which returns markdown. The plugin assembles one note per notebook
(`{targetFolder}/{NotebookName}.md`) with the newest page at the top. Each page is
wrapped in a managed `<!-- rm:page=… -->` block; anything you write outside those
blocks is never touched. If you hand-edit inside a block, your edit is preserved (it
is moved into a collapsed "superseded" callout) rather than overwritten. Unchanged
pages are not re-sent, so no needless OCR calls are made. Only the page image is
sent, and only to the URL you configure — no other network destination.

Pages are OCR'd **one at a time** with a small delay between requests (**OCR request
delay**) to stay under the OCR provider's rate limit. A rate-limited or transient
server error (HTTP 429 / 5xx) is retried with exponential backoff, honoring the
server's `Retry-After`; after a few attempts the page is skipped (non-fatal) and
retried on the next sync. Each page's transcription is saved as soon as it succeeds,
so if a sync is interrupted (or hits a persistent rate limit), the next sync
**resumes from the pages still missing OCR** — it never restarts from scratch or
duplicates pages.

When the OCR engine detects a figure/drawing it emits an image link; the plugin
repoints that to an embed of the page's **own saved image**, placed once **at the top
of that page's section** (under the `## Page N` heading), so figures show up instead
of a broken link. Notes written before this behavior existed are fixed automatically
once (on the next plugin load); you can also re-run it anytime with the **Fix OCR
image links in notes** command.

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
- Network requests only to reMarkable cloud (or your rmfakecloud server when enabled), plus — only when **Transcribe pages to markdown** is enabled — the local OCR server URL you configure

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
