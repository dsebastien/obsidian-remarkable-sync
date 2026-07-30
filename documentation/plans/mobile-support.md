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

### `crypto.randomUUID()` made defensive (unreleased)

Was called at module load in `remarkable-auth.service.ts`. `crypto.randomUUID` is only exposed
in secure contexts, so on a webview that does not qualify it would have thrown during `onload`
and stopped the plugin from loading at all — the worst possible failure mode, and one that
needed a device to detect. Now `utils/uuid.ts#generateUuidV4`, called lazily on first
registration, falling back to `crypto.getRandomValues` and then `Math.random`. Removes the
device dependency from this item entirely.

## Before the flip

### 1. JSZip pulls Node builtins into the bundle — BLOCKER

`.rmdoc` import (`services/import/rmdoc-import.service.ts`) is the only JSZip consumer.
`scripts/build.ts` uses `target: 'node'`, so Bun ignores JSZip's `browser` field and bundles
`lib/index`, which pulls `readable-stream` and emits `require("buffer")`, `require("stream")`,
`require("util")`, `require("events")`.

Those sit inside lazy CommonJS wrappers, so they do **not** break plugin load — but they are
evaluated the moment JSZip actually runs, which will break `.rmdoc` import on mobile.

Two approaches were tested and **both rejected**:

| Approach                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target: 'browser'` globally                           | **Unsafe.** Bun silently replaces `require('node:fs')` with an empty-object stub `(()=>({}))`. `loadNodeModules()` would return a stub that passes its `try/catch`, then fail at `readLegacyTokenFile`, whose own `catch` returns null — so the legacy token import would silently never run and **existing desktop users would be logged out on upgrade** with no error. Also grew the bundle (226 KB vs 129 KB).                                                                                                        |
| Alias `jszip` → `dist/jszip.min.js` via a build plugin | Functionally identical (verified: same entry list and byte lengths on a generated zip), removes **all** `require()` calls, and is ~30 KB smaller. **But** the prebuilt dist _inlines_ the `setimmediate` polyfill, including its old-IE `document.createElement("script")` branch. `stripSetImmediatePolyfillPlugin` matches a module path (`/setimmediate/setImmediate.js`) and can no longer reach it, so this reintroduces the "dynamic script element creation" reviewer warning that was deliberately fixed earlier. |

**Recommended path:** replace JSZip with a browser-native, dependency-free zip reader
(candidate: `fflate`). It removes the Node builtins _and_ the script-element branch in one
move, and shrinks the bundle. The API surface actually used is small, so the swap is contained:

- `JSZip.loadAsync(arrayBuffer)` → unzip the buffer
- iterate `zip.files`, skip `entry.dir`
- `entry.async('arraybuffer')` per file

Needs: a spec covering a real `.rmdoc` fixture, confirmation that `stripSetImmediatePolyfillPlugin`
can then be deleted, and a check that the reviewer's Bun 1.2.14 still builds it.

### 2. `OffscreenCanvas` on iOS — needs a device

`page-renderer.service.ts`, `stroke-renderer.ts`, `utils/image-utils.ts` depend on
`OffscreenCanvas` + `convertToBlob`. Android WebView is fine. iOS needs WKWebView on
iOS 16.4+. **No fallback exists today** — if it fails, every page render returns null and
notebooks sync as empty.

Action: verify on a real iPhone. If unsupported, add an `HTMLCanvasElement` fallback behind a
capability check.

### 3. `.rmdoc` file picker on iOS — needs a device

`commands/import-rmdoc.ts` uses `<input type="file" accept=".rmdoc">`. iOS resolves `accept`
through UTIs and may show no selectable files for an unknown extension.

Action: verify. If broken, drop `accept` on mobile and validate the extension after selection.

### 4. Mobile guards for battery and data

Auto-sync (`services/sync/auto-sync.service.ts`) plus 1404x1872 canvases over cellular.

Action: decide the policy. Suggested — auto-sync defaults to off on mobile, and the settings
section says so.

## Business rules already recorded

- Node builtins must never be imported at the top level of any module under `src/` — the
  bundler hoists them into a top-level `require()` that throws on mobile and prevents the
  plugin from loading. Require them lazily inside a `Platform.isDesktopApp` guard.
- Tokens live in `data.json`, are per-vault, and travel with anything that syncs `.obsidian`.

## Flip checklist

1. Resolve item 1 (JSZip) — self-verifiable, no device needed.
2. Verify items 2 and 3 on a real iPhone and a real Android device.
3. Decide item 4.
4. Set `isDesktopOnly: false`; update `README.md` ("desktop only, v1.4.0+") and `docs/`.
5. Ship as experimental, and say so in the release notes.
