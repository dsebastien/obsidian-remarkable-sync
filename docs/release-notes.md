# Release Notes

## 1.6.0 (2026-07-17)

### Features

- **plugin:** require Obsidian 1.13 and drop the deprecated imperative settings fallback

### Bug Fixes

- **plugin:** use createSpan helper and enum-typed reads flagged by catalog review

## 1.5.0 (2026-07-17)

### Features

- **plugin:** make settings searchable via declarative settings API (Obsidian 1.13+)

### Bug Fixes

- **plugin:** address community review warnings (createEl, redundant assertions, unsafe any)

## 1.4.4 (2026-07-16)

### Bug Fixes

- **auth:** never fail plugin load on malformed token file

## 1.4.3 (2026-06-17)

## 1.4.2 (2026-05-30)

### Bug Fixes

- **sync:** send rm-filename header on /sync/v3/files requests

## 1.4.1 (2026-05-15)

### Bug Fixes

- **all:** fixed bounds calculation before rendering the images

## 1.4.0 (2026-05-15)

### Features

- **all:** enable folding folders in the panel

## 1.3.7 (2026-05-15)

## 1.3.6 (2026-05-15)

## 1.3.5 (2026-05-15)

## 1.3.4 (2026-05-15)

## 1.3.3 (2026-05-14)

### Bug Fixes

- **plugin:** rename sync command id to satisfy lint rule

## 1.3.2 (2026-05-13)

## 1.3.1 (2026-05-13)

## 1.3.0 (2026-03-25)

### Features

- **all:** added refresh button in remarkable panel
- **all:** updated

## 1.2.0 (2026-03-08)

### Features

- **all:** updated

## 1.1.0 (2026-03-08)

### Features

- **all:** optimized images. Added support for WebP. Set JPG by default

## 1.0.0 (2026-03-08)

### Features

- **all:** added rmFakeCloud support

## 0.2.0 (2026-03-07)

### Features

- **all:** added support for importing rmdoc files

## 0.1.0 (2026-03-07)

### Features

- **all:** added fuzzy search
- **all:** automatically list the notebooks when the panel opens
- **all:** better sync pages
- **all:** code cleanup
- **all:** handle token expiration and renewal
- **all:** improved buttons and search behavior
- **all:** improved stroke sizes
- **all:** improved stroke width in images (was still too thick)
- **all:** initial commit

### Bug Fixes

- **all:** fixed logging

## [0.1.0] - 2026-03-07

### Features

- reMarkable cloud authentication via one-time device code
- Sidebar panel view listing notebooks with folder hierarchy
- Per-notebook download (images)
- .rm v6 binary file parsing for stroke data extraction
- Page rendering via OffscreenCanvas with 9+ pen types, colors, and opacity
- Per-page image output
- Inline progress indicators per notebook in panel
- Settings for target folder, image format
- Token storage outside vault for security
