### Fixed

- Syncing works again for accounts on the newer reMarkable cloud format. Since 2.2.0, these accounts saw "1 item(s) could not be read from the reMarkable cloud", and every notebook failed to download. The plugin read a header line of the cloud's index as if it were a file. (#44, #45)

### Maintenance

- Updated dependencies and build tooling.
