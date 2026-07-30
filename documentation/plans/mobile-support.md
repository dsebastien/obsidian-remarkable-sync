# Mobile support (issue #13)

Goal: flip `isDesktopOnly` to `false` so the plugin runs on Obsidian mobile.

Status: **token storage done** (released in 1.13.0). The remaining blockers are below.
`isDesktopOnly` stays `true` until every item in "Before the flip" is resolved.

## Already mobile-safe (verified by reading the code)

- All HTTP goes through Obsidian's `requestUrl` — no `fetch`, no `node-fetch`.
- Vault writes use `vault.createBinary`.
- Binary parsing uses `DataView`/typed arrays, no `Buffer`.
- Pages render sequentially (`notebook-pipeline.service.ts`), so no fan-out memory spike.

## Done

### Token storage → `data.json` (1.13.0)

Tokens moved out of `~/.remarkable-sync/token.json`, which is unwritable on mobile.
Legacy file imported once per vault, never auto-deleted. See
`documentation/history/2026-07-30.md`.

### JSZip replaced with fflate (unreleased)

JSZip was bundled through its Node entry point and pulled `require("buffer")`, `require("stream")`,
`require("util")`, `require("events")` into the bundle, which would have broken `.rmdoc` import on
mobile. Replaced with `fflate`, imported as **`fflate/browser`** — fflate's default (`node`) entry
starts with a top-level `require("module")` + `worker_threads`, which is the same hoisted-require
trap. `unzipSync` deliberately: the async variant pulls in worker machinery (`new Worker` over a
blob URL) that the reviewer flags.

Two alternatives were tested and rejected first:

| Approach                                         | Result                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target: 'browser'` globally                     | **Unsafe.** Bun silently rewrites `require('node:fs')` to an empty-object stub `(()=>({}))`. `loadNodeModules()` would return the stub (its `try/catch` passes), then fail inside `readLegacyTokenFile`, whose own `catch` returns null — the legacy token import would silently never run and **existing desktop users would be logged out on upgrade, with no error**. Also grew the bundle. |
| Alias `jszip` → its prebuilt `dist/jszip.min.js` | Functionally identical and smaller, but the prebuilt dist _inlines_ the `setimmediate` polyfill including its old-IE `document.createElement("script")` branch, which `stripSetImmediatePolyfillPlugin` can no longer reach. Reintroduces the reviewer warning fixed on 2026-07-29.                                                                                                            |

Verified: byte-identical extraction vs JSZip on an archive written by Python's `zipfile` (mixed
deflate/stored, explicit directory entry); `dist/main.js` now contains no `require()` beyond
`obsidian` and the three guarded desktop-only Node builtins, and zero
`createElement("script")` / `new Worker` / `createObjectURL`; builds cleanly under the reviewer's
Bun 1.2.14 with identical output. `stripSetImmediatePolyfillPlugin` deleted — nothing pulls
`setimmediate` any more.

### `crypto.randomUUID()` made defensive (unreleased)

Was called at module load in `remarkable-auth.service.ts`. `crypto.randomUUID` is only exposed
in secure contexts, so on a webview that does not qualify it would have thrown during `onload`
and stopped the plugin from loading at all — the worst possible failure mode, and one that
needed a device to detect. Now `utils/uuid.ts#generateUuidV4`, called lazily on first
registration, falling back to `crypto.getRandomValues` and then `Math.random`. Removes the
device dependency from this item entirely.

## Before the flip

### 1. `OffscreenCanvas` on iOS — needs a device

`page-renderer.service.ts`, `stroke-renderer.ts`, `utils/image-utils.ts` depend on
`OffscreenCanvas` + `convertToBlob`. Android WebView is fine. iOS needs WKWebView on
iOS 16.4+. **No fallback exists today** — if it fails, every page render returns null and
notebooks sync as empty.

Action: verify on a real iPhone. If unsupported, add an `HTMLCanvasElement` fallback behind a
capability check.

### 2. `.rmdoc` file picker on iOS — needs a device

`commands/import-rmdoc.ts` uses `<input type="file" accept=".rmdoc">`. iOS resolves `accept`
through UTIs and may show no selectable files for an unknown extension.

Action: verify. If broken, drop `accept` on mobile and validate the extension after selection.

### 3. Mobile guards for battery and data

Auto-sync (`services/sync/auto-sync.service.ts`) plus 1404x1872 canvases over cellular.

Action: decide the policy. Suggested — auto-sync defaults to off on mobile, and the settings
section says so.

## Business rules already recorded

- Node builtins must never be imported at the top level of any module under `src/` — the
  bundler hoists them into a top-level `require()` that throws on mobile and prevents the
  plugin from loading. Require them lazily inside a `Platform.isDesktopApp` guard.
- Tokens live in `data.json`, are per-vault, and travel with anything that syncs `.obsidian`.

## Flip checklist

1. Verify items 1 and 2 on a real iPhone and a real Android device.
2. Decide item 3.
3. Set `isDesktopOnly: false`; update `README.md` ("desktop only, v1.4.0+") and `docs/`.
4. Ship as experimental, and say so in the release notes.
