### Sync you can trust

- **Edited notebooks are picked up again.** A notebook you changed on the device after its first sync could stay marked as synced forever, so automatic sync skipped it. Sync now compares the cloud's own timestamps, so edits are detected. After updating, notebooks you edited since their last sync will all show "Needs sync" at once: that is real work catching up, not a new bug.
- **Untouched notebooks are no longer downloaded again and again.** A failed or partial cloud listing (offline, a timeout, a rate limit) used to erase the plugin's sync state, and the next run downloaded your whole library again. The state is now only cleaned up after a complete listing.
- **Notes no longer land in a shorter folder path when a folder cannot be read.** When the cloud could not return a folder's details, its notebooks could be written to a shorter path, then to the right one on the next sync, leaving a copy behind. Such notebooks are now held back until their folder can be read.
- **A notebook is only marked synced when every file arrived.** A download with missing pages now fails instead of being processed with pages absent.

### Kinder to large accounts and flaky connections

- At most 6 requests run at once per listing or download, rate limits and server errors are retried with backoff, and an outage now stops the sync quickly instead of retrying for a long time.
- The sidebar keeps showing your last known notebooks when a refresh fails or is partial. The ones it could not refresh are greyed out and cannot be synced until a refresh succeeds, and a banner says what happened.
- Messages say what went wrong: "reconnect" when the reMarkable cloud refuses your device's credentials, "try again later" when it could not be reached.

### Safer files in your vault

- The highlights note's link to the annotated PDF now works for notebook names containing `[`, `]`, `|` or `^` (a name that also contains `#` or `:` is shown as plain text instead of a link).
- The target folder is checked in the settings (no absolute paths, `..` or characters other systems reject), and a hand-edited value is kept inside the vault on load.
- A folder or file already sitting where the plugin wants to write now produces a clear error naming the path.
- The documentation now warns that generated files are overwritten when their notebook syncs again: annotate on the device, or rename a file to keep your edits (the plugin then recreates the original next to it).

### Thanks

Many of these fixes come from delize's careful reports and patches.
