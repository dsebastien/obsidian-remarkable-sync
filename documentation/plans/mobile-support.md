# Mobile support (issue #13)

Status: **shipped experimental in 1.14.0.** `isDesktopOnly` is `false`. Issue #13 closed.

Everything verifiable without hardware is done. What remains is field feedback and the
contingency work it may trigger. Keep this plan open until mobile is either confirmed working
or the fallbacks below are implemented.

## Shipped

| Change                                                                                                                                                          | Release |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Tokens moved to `data.json` (nothing outside the vault is writable on mobile), legacy desktop file imported once per vault                                      | 1.13.0  |
| `crypto.randomUUID` made defensive — it was called at module load and is secure-context gated, so it could have stopped the plugin loading entirely             | 1.14.0  |
| JSZip → `fflate/browser`; removed `require("buffer"/"stream"/"util"/"events")` from the bundle                                                                  | 1.14.0  |
| `isPageRenderingSupported()` gates the sync pipeline and `.rmdoc` import, so an unsupported device names the cause instead of reporting generic render failures | 1.14.0  |
| `isDesktopOnly: false`, README/docs mobile section                                                                                                              | 1.14.0  |

Auto-sync already defaulted to off, so the battery/data concern needed no new code.

## Awaiting field reports

Nothing here can be progressed without a device or a user report.

### 1. `OffscreenCanvas` on iOS

`page-renderer.service.ts`, `stroke-renderer.ts` and `utils/image-utils.ts` need both
`OffscreenCanvas` and `convertToBlob`. Android's webview is fine. iOS needs 16.4+.

Users below that now get a clear message rather than empty notebooks, but **there is still no
fallback**.

If reports show this failing: render into an `HTMLCanvasElement` and use `toBlob` behind the
existing `isPageRenderingSupported()` seam. The renderer already takes a canvas and returns an
`ArrayBuffer`, so the change is contained to `renderPageToCanvas` and `utils/image-utils.ts`.

### 2. `.rmdoc` file picker on iOS

`commands/import-rmdoc.ts` uses `<input type="file" accept=".rmdoc">`. iOS resolves `accept`
through UTIs and may offer no selectable files for an unknown extension. Cloud sync is
unaffected — this only blocks local import.

If reports confirm it: drop `accept` when `Platform.isIosApp`, and validate the extension after
selection instead.

### 3. ~~Icons/buttons not rendering on Android (issue #19)~~ — fixed

First field report, and the first mobile bug found. Root cause:
`.is-tablet button:not(.clickable-icon)` forces `padding: 4px 20px`, which against the icon
buttons' fixed `w-7` width and `border-box` drove the content box negative and collapsed the icon
to zero width. Fixed by adding Obsidian's `clickable-icon` class. Reproduced and verified with
`obsidian dev:mobile on`; details in `documentation/history/2026-08-12.md`.

**Generalise this before it recurs:** any plugin element with a fixed size that Obsidian also
styles by element selector can be overridden by the mobile stylesheet, which is more aggressive
than the desktop one. `dev:mobile on` reproduces it locally — use it before shipping UI.

### 4. Memory and responsiveness on phones

Not measured on a real device. A 1404x1872 canvas is ~10 MB of RGBA; pages render sequentially,
so peak use should be one page at a time, but a large notebook downloads in full before parsing.
`unzipSync` also inflates `.rmdoc` archives on the UI thread.

Watch for reports of freezes or crashes on large notebooks before optimising — the sequential
design may already be adequate.

## Verification still outstanding on desktop

Neither release was exercised in a real vault. These are cheap and worth doing once:

- Upgrade an install that predates 1.13.0: it should stay connected, `data.json` should gain
  `tokens` and `legacyTokensImported`, and `~/.remarkable-sync/token.json` should still exist.
- Change a setting, restart, confirm still connected (guards the `saveData` clobber fix).
- Disconnect, restart, confirm it stays disconnected (guards the legacy re-import fix).
- Import a **real** `.rmdoc` export. The specs use synthetic archives from four independent zip
  writers; no genuine reMarkable export was ever tested.

## Business rules recorded

- Node builtins must never be imported at the top level of any module under `src/` — the bundler
  hoists them into a top-level `require()` that throws on mobile. Require them lazily inside a
  `Platform.isDesktopApp` guard.
- Dependencies that ship a browser entry point must be imported through it (`fflate/browser`).
  Do not switch the build to `target: 'browser'` — Bun then silently stubs `require('node:fs')`.
- The shipped stylesheet must never contain a global reset. A plugin stylesheet applies to the
  whole Obsidian document, so Tailwind Preflight is excluded: import `tailwindcss/theme` and
  `tailwindcss/utilities`, never bare `tailwindcss`. Anything the plugin needs from a reset is
  scoped to `[class^='remarkable-']`.
- Tokens live in `data.json`, are per-vault, and travel with anything that syncs `.obsidian`.

## Next catalog review

1.14.0 is the first release with `isDesktopOnly: false`, so the community reviewer will apply
its mobile rules to this plugin for the first time. `import/no-nodejs-modules` is now active
locally and clean. If the review returns findings, check sibling plugin commits for existing
fixes before inventing new ones.
