### Improved

- **A notebook that keeps failing no longer drains automatic sync.** Automatic sync used to download it again on every run, without telling you. Now it retries less often each time (up to every 16 runs), and tells you once, with the reason, after the second failure in a row. It tries again right away when the notebook changes on your device, and syncing it from the panel always tries immediately.
- **One unreadable notebook no longer blocks cleanup.** If the reMarkable cloud cannot serve one item, the plugin still forgets notebooks you deleted on the device, and stops asking the cloud for that item until it changes.
- **Quieter warning for the same unreadable items.** When a refresh cannot read the same items as the previous one, the panel shows a short muted note instead of the red banner.

### Fixed

- A notebook whose cloud index listed one of its files twice failed to download on every sync.
