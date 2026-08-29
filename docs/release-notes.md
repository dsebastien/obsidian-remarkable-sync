# Release Notes

## 2.0.0 (2026-08-29)

### ⚠ BREAKING CHANGES

- **plugin:** minAppVersion moves from 1.8.7 to 1.13.0 — the
  declarative settings API (getSettingDefinitions) only exists there.

getSettingDefinitions() replaces the display() tab and its eight section
renderers wholesale. The per-section redisplay callbacks are dead under
this API (display() never runs), so the connect/disconnect flows, the
legacy-token removal and every visibility-affecting write now re-render
through update() instead. The conditional rows (server URL, cloud-change
warning, sync interval, image quality) declare visible: hooks over live
state; the connection status row renders both its description and its
Connect/Disconnect button from live state; the cloud-change warning is
an info row with the mandatory no-op render hook (definitions with
neither control nor render are skipped entirely).

updateSettings is now persist-then-commit INSIDE the same write queue as
the token writes: the produce() derives from the previously committed
state, the merged data.json (settings plus sibling token entries) is
saved first, and memory is swapped only after the write lands — a
settings save can no longer clobber a concurrent token refresh, and the
old commit-before-save ordering is gone. setControlValue rejects type
mismatches, non-finite/out-of-range numbers, out-of-enum dropdown values
and unknown keys; an invalid rmfakecloud URL is now refused with the
framework's inline error where the old tab painted an error span but
persisted the value anyway.

9 new tests cover the write path — persist-then-commit ordering and
write serialization are mutation-checked (deliberately regressed
implementations fail them) and the token-preservation property is
asserted against the merged write. 482 tests, tsc, lint
--max-warnings 0 and build green; the prefer-setting-definitions
advisory from the previous commit is now satisfied.

### Features

- **plugin:** declare the settings tab (Obsidian 1.13 declarative settings)

### Bug Fixes

- **build:** align with the catalog reviewer's archive, ruleset and audit
- **build:** harden the release path after adversarial review

## 1.16.0 (2026-08-20)

### Features

- **domain:** scale ink per device across all five models
- **highlights:** parse text highlights and embed them in the PDF
- **output:** add a deterministic PDF writer
- **output:** burn annotations back onto source PDFs
- **output:** write one PDF per notebook behind a save-as-PDF toggle
- **parser:** extract typed text into a note
- **parser:** read the colour a glyph range carries, closes [#acff85](https://github.com/dsebastien/obsidian-remarkable-sync/issues/acff85)
- **renderer:** read per-stroke colour, opacity and fixed nib widths
- **settings:** make the highlights note opt-in

### Bug Fixes

- **domain:** give the shading marker its real width
- **domain:** take pen colours and widths from the reference renderer
- **output:** safe highlight text encoding and correct rotated-page mapping
- **output:** skip vault writes when the bytes are unchanged
- **output:** write EPUB sources under their own extension
- **output:** write unannotated sources, stop buffering unused pages, surface failures
- **parser:** correct the typed text layout against a real notebook
- **parser:** order typed text per position so mid-run insertions survive
- **pdf:** give highlight annotations an explicit appearance stream, closes [#acff85](https://github.com/dsebastien/obsidian-remarkable-sync/issues/acff85)
- **pdf:** place pages at their physical size, not a fixed 1872 units
- **renderer:** highlighter compositing and typed-only pages
- **renderer:** map the newer firmware stroke colours
- **renderer:** port the real per-pen width response
- **settings:** stop savePdf resetting to false on every restart
- **settings:** validate constrained values on load

## 1.15.0 (2026-08-12)

### Features

- **panel:** sort notebooks within each folder ([#15](https://github.com/dsebastien/obsidian-remarkable-sync/issues/15))

### Bug Fixes

- **panel:** render icon buttons on mobile
- **plugin:** stop shipping Tailwind Preflight in the stylesheet [#19](https://github.com/dsebastien/obsidian-remarkable-sync/issues/19) [#19](https://github.com/dsebastien/obsidian-remarkable-sync/issues/19)
- **renderer:** map the stroke colours newer firmware emits ([#14](https://github.com/dsebastien/obsidian-remarkable-sync/issues/14))

## 1.14.0 (2026-07-30)

### Features

- **plugin:** enable experimental mobile support
- **plugin:** replace JSZip with fflate for .rmdoc extraction

### Bug Fixes

- **plugin:** generate the device id without crypto.randomUUID

## 1.13.0 (2026-07-30)

### Features

- **plugin:** show what's new in a tab instead of a modal dialog
- **plugin:** store reMarkable tokens in plugin data
- **plugin:** surface support CTAs everywhere users can see them

## 1.12.0 (2026-07-29)

### Features

- **plugin:** aggregate what's new dialogs across simultaneously updated plugins

## 1.11.0 (2026-07-29)

### Features

- **plugin:** add Knowii community to the what's new dialog and harden it

## 1.10.0 (2026-07-29)

### Features

- **plugin:** surface per-page render failures instead of dropping silently

## 1.9.1 (2026-07-29)

### Bug Fixes

- **plugin:** parse version-1 line blocks (24-byte float points)
- **plugin:** warn on unknown line-block versions instead of failing silently

## 1.9.0 (2026-07-29)

### Features

- **plugin:** add automatic background sync on a configurable interval
- **plugin:** prune orphaned sync state after each cloud refresh

### Bug Fixes

- **build:** keep the release build compatible with older Bun versions
- **deps:** bump fast-uri and brace-expansion past vulnerability advisories
- **plugin:** drop 1.13-only declarative settings API for stable Obsidian

## 1.8.0 (2026-07-27)

### Features

- **plugin:** show a what's new dialog once after plugin updates

### Reverts

- Revert "feat(plugin): require Obsidian 1.13 and drop the deprecated imperative settings fallback"

## 1.7.0 (2026-07-17)

### Features

- **plugin:** add hover tooltip to notebook sync status dot

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
