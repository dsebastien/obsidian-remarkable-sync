---
title: Configuration
nav_order: 3
---

# Configuration

All settings are accessible via **Settings → Community plugins → Remarkable Synchronizer**.

## Settings

| Setting         | Type     | Default | Description                                                                      |
| --------------- | -------- | ------- | -------------------------------------------------------------------------------- |
| Target folder   | text     | `""`    | Vault-relative path where output files are saved. Leave empty for vault root.    |
| Save images     | toggle   | `true`  | Save rendered page images                                                        |
| Save as PDF     | toggle   | `false` | Write one PDF per notebook, beside the page images                               |
| Image format    | dropdown | `jpeg`  | Format for rendered images: JPEG, WebP, or PNG                                   |
| Image quality   | slider   | `0.85`  | Quality for JPEG/WebP (0.1 = smallest, 1.0 = best). Hidden when PNG is selected. |
| Use rmfakecloud | toggle   | `false` | Connect to a self-hosted rmfakecloud server instead of the official cloud        |
| Server URL      | text     | `""`    | Base URL of your rmfakecloud server (only shown when rmfakecloud is enabled)     |
| Automatic sync  | toggle   | `false` | Periodically sync all notebooks that need updating in the background             |
| Sync interval   | slider   | `30`    | Minutes between automatic syncs, 5–240 (only shown when automatic sync is on)    |

## Image Formats

- **JPEG** (default) — lossy compression, small file size, good for handwritten notes
- **WebP** — lossy compression, smaller than JPEG at equivalent quality
- **PNG** — lossless, larger files, no quality slider

The quality slider controls the compression level for JPEG and WebP. Lower values produce smaller files, higher values preserve more detail. The slider is hidden when PNG is selected since PNG is always lossless.

## PDF

**Save as PDF** writes one PDF per notebook, containing every page that has content. It is independent of **Save images**, so you can enable either, both, or neither.

The PDF is written beside the folder holding the page images, so both can be produced without colliding:

```
reMarkable/
  Work/
    Meeting.pdf          <- Save as PDF
    Meeting/
      Meeting-P001.jpeg  <- Save images
      Meeting-P002.jpeg
```

Pages are sized from the rendered image at 226 DPI, which matches the physical size of the reMarkable screen (about 6.2 x 8.3 inches). A page whose content scrolled past the bottom of the device viewport produces a taller PDF page rather than a cropped one.

A PDF cannot store WebP. When the image format is WebP, pages are embedded in the PDF as JPEG at the configured quality, while the loose image files stay WebP.

### Annotated PDFs and EPUBs

If the document came from a PDF you imported onto your reMarkable, **Save as PDF** does something different and better: instead of assembling page images, it writes the original document through unchanged and adds an annotated copy beside it.

```
reMarkable/
  Papers/
    Some paper.pdf               <- the original, untouched
    Some paper (annotated).pdf   <- the same document with your ink drawn on it
```

The annotated copy keeps the original's text layer, so it stays selectable and searchable, and every page survives even if you only annotated one. Your handwriting is drawn as vector paths, not flattened into an image, so it stays sharp at any zoom.

Pages you inserted on the device have no counterpart in the original and are left out of the annotated copy. An encrypted PDF cannot be annotated, and in that case the original is still written to your vault.

EPUBs are written through unchanged but not annotated, because the device lays them out itself and there are no fixed pages to draw on.

Generated PDFs deliberately carry no creation or modification date. Re-syncing an unchanged notebook produces exactly the same bytes, and the plugin skips the write entirely, so nothing churns if you sync your vault with Obsidian Sync, Git or Dropbox.

## Sorting the panel

The panel's **Sort** picker controls the order of notebooks within each folder:

| Option            | Order                  |
| ----------------- | ---------------------- |
| Recently modified | newest first (default) |
| Oldest modified   | oldest first           |
| Name (A–Z)        | alphabetical           |
| Name (Z–A)        | reverse alphabetical   |

Names compare numerically, so "Notebook 2" comes before "Notebook 10" rather than after it. Your choice is remembered between sessions.

Folder order is unaffected: the top-level group stays first, and the rest stay alphabetical.

## Automatic sync

When **Automatic sync** is enabled, the plugin periodically syncs all notebooks that need updating (same rules as the panel's **Sync all** button). Runs are skipped while disconnected and when a sync is already in progress. Each run also cleans up sync state for notebooks that were deleted on your reMarkable — files already saved in your vault are never deleted.

## Authentication

The authentication section shows your connection status and provides connect/disconnect buttons.

Tokens are stored in the plugin's `data.json`, inside `.obsidian/plugins/remarkable-synchronizer/`. The user token auto-refreshes every 23 hours.

They are kept separate from your plugin settings, so they never show up in the debug log. They do live inside the vault, though: if you sync `.obsidian` (Obsidian Sync's _community plugin settings_ option, Git, Dropbox, ...), your reMarkable credentials sync with it.

If you used an earlier desktop version, your tokens were in `~/.remarkable-sync/token.json`. They are imported automatically the first time each vault runs this version. The old file is left in place because it is shared by all your vaults — once they have all been updated, remove it with the **Legacy token file → Remove** button in the settings tab.

## rmfakecloud

To use a self-hosted [rmfakecloud](https://github.com/ddvk/rmfakecloud) server:

1. Enable **"Use rmfakecloud"** in the Cloud settings section
2. Enter your server URL (e.g., `https://cloud.example.com` or `http://localhost:3000`)
3. Disconnect and reconnect if you were previously connected to a different cloud

The server URL must be a valid HTTP or HTTPS URL. When enabled, all authentication and sync requests go to your rmfakecloud server instead of the official reMarkable cloud.

**Note:** Tokens are not transferable between clouds. Switching between official cloud and rmfakecloud requires disconnecting and reconnecting.

## About

The about section includes links to follow the developer and support the project.
