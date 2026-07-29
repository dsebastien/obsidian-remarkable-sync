# Changelog

All notable changes to this project will be documented in this file.

## [1.10.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.9.1...1.10.0) (2026-07-29)

### Features

* **plugin:** surface per-page render failures instead of dropping silently ([a776a8e](https://github.com/dsebastien/obsidian-remarkable-sync/commit/a776a8e5235e12701a82c1172185bdc9e65885ce)), closes [#12](https://github.com/dsebastien/obsidian-remarkable-sync/issues/12)

## [1.9.1](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.9.0...1.9.1) (2026-07-29)

### Bug Fixes

* **plugin:** parse version-1 line blocks (24-byte float points) ([3abd751](https://github.com/dsebastien/obsidian-remarkable-sync/commit/3abd7515de929de9bd9e0e88827077d6631ef55d)), closes [#12](https://github.com/dsebastien/obsidian-remarkable-sync/issues/12)
* **plugin:** warn on unknown line-block versions instead of failing silently ([3f8bfb4](https://github.com/dsebastien/obsidian-remarkable-sync/commit/3f8bfb4911328c1e395c97baec84c43cdab4497f))

## [1.9.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.8.0...1.9.0) (2026-07-29)

### Features

* **plugin:** add automatic background sync on a configurable interval ([3ee0110](https://github.com/dsebastien/obsidian-remarkable-sync/commit/3ee011008724954d095ad84557f95a43ad1525d5)), closes [#8](https://github.com/dsebastien/obsidian-remarkable-sync/issues/8)
* **plugin:** prune orphaned sync state after each cloud refresh ([7eef6ec](https://github.com/dsebastien/obsidian-remarkable-sync/commit/7eef6ec0e48c326dcf41a1bd725355de31c6d736)), closes [#9](https://github.com/dsebastien/obsidian-remarkable-sync/issues/9)

### Bug Fixes

* **build:** keep the release build compatible with older Bun versions ([adee72c](https://github.com/dsebastien/obsidian-remarkable-sync/commit/adee72c39c4d42457457c540f7dbf58a82749b7a))
* **deps:** bump fast-uri and brace-expansion past vulnerability advisories ([8a52fc4](https://github.com/dsebastien/obsidian-remarkable-sync/commit/8a52fc43efced223be03b54913aa64677f5efdb6))
* **plugin:** drop 1.13-only declarative settings API for stable Obsidian ([8da625c](https://github.com/dsebastien/obsidian-remarkable-sync/commit/8da625c4f2c17eb2a5b4a9ab1fcb0c211c8c7e63)), closes [#11](https://github.com/dsebastien/obsidian-remarkable-sync/issues/11)

## [1.8.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.7.0...1.8.0) (2026-07-27)

### Features

* **plugin:** show a what's new dialog once after plugin updates ([9b78aa5](https://github.com/dsebastien/obsidian-remarkable-sync/commit/9b78aa589ce059f97b6b592e05b691aad02d6657))

### Reverts

* Revert "feat(plugin): require Obsidian 1.13 and drop the deprecated imperative settings fallback" ([fb7c3ee](https://github.com/dsebastien/obsidian-remarkable-sync/commit/fb7c3eeef48eb0c9cb72be5cd64f26bd71643a0c))

## [1.7.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.6.0...1.7.0) (2026-07-17)

### Features

* **plugin:** add hover tooltip to notebook sync status dot ([add020c](https://github.com/dsebastien/obsidian-remarkable-sync/commit/add020cab7e77b8921e7f3a8e7035c1430359c50))

## [1.6.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.5.0...1.6.0) (2026-07-17)

### Features

* **plugin:** require Obsidian 1.13 and drop the deprecated imperative settings fallback ([99637fc](https://github.com/dsebastien/obsidian-remarkable-sync/commit/99637fc090ccf954419bb90147e7bf4c25e6ab4b))

### Bug Fixes

* **plugin:** use createSpan helper and enum-typed reads flagged by catalog review ([e017844](https://github.com/dsebastien/obsidian-remarkable-sync/commit/e017844827be9a3ab8665241630d2ae559587413))

## [1.5.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.4.4...1.5.0) (2026-07-17)

### Features

* **plugin:** make settings searchable via declarative settings API (Obsidian 1.13+) ([04d5d00](https://github.com/dsebastien/obsidian-remarkable-sync/commit/04d5d0090cd539deeed1ac5f117fac2eb5a1beb4))

### Bug Fixes

* **plugin:** address community review warnings (createEl, redundant assertions, unsafe any) ([1d1e69d](https://github.com/dsebastien/obsidian-remarkable-sync/commit/1d1e69d819c0bdfb140c0b263f963825870ba17d))

## [1.4.4](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.4.3...1.4.4) (2026-07-16)

### Bug Fixes

* **auth:** never fail plugin load on malformed token file ([a696a08](https://github.com/dsebastien/obsidian-remarkable-sync/commit/a696a083ecb52f2e9ccf4bd1d16f5a3455460e1c))

## [1.4.3](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.4.2...1.4.3) (2026-06-17)

## [1.4.2](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.4.1...1.4.2) (2026-05-30)

### Bug Fixes

* **sync:** send rm-filename header on /sync/v3/files requests ([3602a2e](https://github.com/dsebastien/obsidian-remarkable-sync/commit/3602a2ef14dc26cfabd9730ef8ac9cb9fda8e2df)), closes [#6](https://github.com/dsebastien/obsidian-remarkable-sync/issues/6)

## [1.4.1](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.4.0...1.4.1) (2026-05-15)

### Bug Fixes

* **all:** fixed bounds calculation before rendering the images ([13adc67](https://github.com/dsebastien/obsidian-remarkable-sync/commit/13adc6794b8ba42d1780aed3a766f25e7544f44e)), closes [#3](https://github.com/dsebastien/obsidian-remarkable-sync/issues/3)

## [1.4.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.3.7...1.4.0) (2026-05-15)

### Features

* **all:** enable folding folders in the panel ([6ae88cf](https://github.com/dsebastien/obsidian-remarkable-sync/commit/6ae88cf00c678521cca5bedc07e2f962943626ef)), closes [#4](https://github.com/dsebastien/obsidian-remarkable-sync/issues/4)

## [1.3.7](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.3.6...1.3.7) (2026-05-15)

## [1.3.6](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.3.5...1.3.6) (2026-05-15)

## [1.3.5](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.3.4...1.3.5) (2026-05-15)

## [1.3.4](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.3.3...1.3.4) (2026-05-15)

## [1.3.3](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.3.2...1.3.3) (2026-05-14)

### Bug Fixes

* **plugin:** rename sync command id to satisfy lint rule ([fe5350f](https://github.com/dsebastien/obsidian-remarkable-sync/commit/fe5350fd786faad4057a7169cfb698a2215ad5ca))

## [1.3.2](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.3.1...1.3.2) (2026-05-13)

## [1.3.1](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.3.0...1.3.1) (2026-05-13)

## [1.3.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.2.0...1.3.0) (2026-03-25)

### Features

* **all:** added refresh button in remarkable panel ([1e7c3ff](https://github.com/dsebastien/obsidian-remarkable-sync/commit/1e7c3ff8e1d9e6ebd69a680c0ad3fc58905172d7)), closes [#2](https://github.com/dsebastien/obsidian-remarkable-sync/issues/2)
* **all:** updated ([8751bb8](https://github.com/dsebastien/obsidian-remarkable-sync/commit/8751bb8ed8fcf87eae7ff6e099f6b7f9b8d7a7eb))

## [1.2.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.1.0...1.2.0) (2026-03-08)

### Features

* **all:** updated ([179b4d4](https://github.com/dsebastien/obsidian-remarkable-sync/commit/179b4d428a9483e818c07a1ffc3eb2e9f37f5b31))

## [1.1.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/1.0.0...1.1.0) (2026-03-08)

### Features

* **all:** optimized images. Added support for WebP. Set JPG by default ([f1de2bb](https://github.com/dsebastien/obsidian-remarkable-sync/commit/f1de2bbe37163920c1f6c4431526e5b1549a3054))

## [1.0.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/0.2.0...1.0.0) (2026-03-08)

### Features

* **all:** added rmFakeCloud support ([4f6ca03](https://github.com/dsebastien/obsidian-remarkable-sync/commit/4f6ca03e2c7cc8be0d325b678171f638506ba6dc))

## [0.2.0](https://github.com/dsebastien/obsidian-remarkable-sync/compare/0.1.0...0.2.0) (2026-03-07)

### Features

* **all:** added support for importing rmdoc files ([2e981f7](https://github.com/dsebastien/obsidian-remarkable-sync/commit/2e981f7594253eff8db4580a7709bef497cedf7e))

## 0.1.0 (2026-03-07)

### Features

* **all:** added fuzzy search ([97736fd](https://github.com/dsebastien/obsidian-remarkable-sync/commit/97736fd8f69efb762db10ebede096a59c89b3a1d))
* **all:** automatically list the notebooks when the panel opens ([f82448c](https://github.com/dsebastien/obsidian-remarkable-sync/commit/f82448c917647ecc3d0108fe0d1507391c144f92))
* **all:** better sync pages ([748515b](https://github.com/dsebastien/obsidian-remarkable-sync/commit/748515b70ed6dafcf23c2b15f1e47b597d229476))
* **all:** code cleanup ([3ac02dd](https://github.com/dsebastien/obsidian-remarkable-sync/commit/3ac02dd764a55fc41019b69b4c8f45e1a83e27ae))
* **all:** handle token expiration and renewal ([cbe6e11](https://github.com/dsebastien/obsidian-remarkable-sync/commit/cbe6e1130f3927286c53a98dd4db06a3cb1a8d1c))
* **all:** improved buttons and search behavior ([4f5dfa3](https://github.com/dsebastien/obsidian-remarkable-sync/commit/4f5dfa3d72a0b45e038f3bb794be9e1d721f1ef4))
* **all:** improved stroke sizes ([1fc8c6f](https://github.com/dsebastien/obsidian-remarkable-sync/commit/1fc8c6f05c723bb55ce936fd0da38dc271ed6965))
* **all:** improved stroke width in images (was still too thick) ([28c8cec](https://github.com/dsebastien/obsidian-remarkable-sync/commit/28c8cec6ac9baac9bce1869741b051c6c5fd50fa))
* **all:** initial commit ([6cb55d8](https://github.com/dsebastien/obsidian-remarkable-sync/commit/6cb55d89d6f88dc2048930791fa0b1b2686ad59b))

### Bug Fixes

* **all:** fixed logging ([8debbd4](https://github.com/dsebastien/obsidian-remarkable-sync/commit/8debbd4a201d386aff7833db68cbf982cafaed0c))

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

























