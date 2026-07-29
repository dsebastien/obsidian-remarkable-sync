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

The quality slider controls the compression level for JPEG and WebP. Lower values produce smaller files; higher values preserve more detail. The slider is hidden when PNG is selected since PNG is always lossless.

## Automatic sync

When **Automatic sync** is enabled, the plugin periodically syncs all notebooks that need updating (same rules as the panel's **Sync all** button). Runs are skipped while disconnected and when a sync is already in progress. Each run also cleans up sync state for notebooks that were deleted on your reMarkable — files already saved in your vault are never deleted.

## Authentication

The authentication section shows your connection status and provides connect/disconnect buttons.

Tokens are stored at `~/.remarkable-sync/token.json` (outside the vault for security). The user token auto-refreshes every 23 hours.

## rmfakecloud

To use a self-hosted [rmfakecloud](https://github.com/ddvk/rmfakecloud) server:

1. Enable **"Use rmfakecloud"** in the Cloud settings section
2. Enter your server URL (e.g., `https://cloud.example.com` or `http://localhost:3000`)
3. Disconnect and reconnect if you were previously connected to a different cloud

The server URL must be a valid HTTP or HTTPS URL. When enabled, all authentication and sync requests go to your rmfakecloud server instead of the official reMarkable cloud.

**Note:** Tokens are not transferable between clouds. Switching between official cloud and rmfakecloud requires disconnecting and reconnecting.

## About

The about section includes links to follow the developer and support the project.
