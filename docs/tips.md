# Tips and Best Practices

## Choosing an Image Format

- Use **JPEG** (default) for the best balance of quality and file size. Works well for handwritten notes.
- Use **WebP** for even smaller files if your workflow supports it (most modern tools do).
- Use **PNG** only when you need pixel-perfect lossless images. Files will be significantly larger.

A quality setting of **0.85** (default) is a good starting point for JPEG/WebP. Lower it to 0.6–0.7 if vault size is a concern; raise it to 0.95+ if you need crisp detail.

## Organizing Output

Set a dedicated **Target folder** (e.g., `reMarkable`) to keep synced notebooks separate from the rest of your vault. The plugin preserves reMarkable's folder hierarchy inside the target folder.

## Efficient Syncing

- **Sync status dots** tell you at a glance which notebooks need attention. Only notebooks marked "needs sync" or "never synced" are processed when you use **Sync all**.
- Use **checkboxes + Sync selected** for partial syncs — useful when you only want to update a few notebooks.
- Use the **search bar** and **filter buttons** (All / Selected / Unselected) to quickly find notebooks in large collections.

## Switching Between Clouds

If you switch between the official reMarkable cloud and a self-hosted rmfakecloud:

1. **Disconnect** first (tokens are not transferable)
2. Toggle the **Use rmfakecloud** setting and configure the URL
3. **Reconnect** with a new one-time code from the appropriate service

## Importing .rmdoc Files

You can process `.rmdoc` files without any cloud connection. This is handy for:

- Files shared by someone else
- Backups exported from a reMarkable tablet
- Testing the plugin before connecting to the cloud

## Troubleshooting

### "Not connected" message in the panel

Make sure you have run the **"Connect to reMarkable cloud"** command and entered a valid one-time code. If using rmfakecloud, verify the server URL is correct and the server is reachable.

### Token expired or authentication errors

The plugin automatically refreshes tokens. If you still see auth errors, try disconnecting and reconnecting. The token file is stored at `~/.remarkable-sync/token.json` — you can delete it manually if needed.

### Notebooks not appearing after refresh

Verify your reMarkable account has notebooks. If using rmfakecloud, ensure your server is running and the API is accessible.

### Large notebooks take a long time

Each page is rendered individually using OffscreenCanvas. Notebooks with many pages will take proportionally longer. Progress is shown inline in the panel.

### Images look too thick or too thin

Stroke rendering is calibrated for the reMarkable's native resolution. If results look off, check that you are using the latest version of the plugin.
