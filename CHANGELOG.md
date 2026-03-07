# Changelog

All notable changes to this project will be documented in this file.

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

