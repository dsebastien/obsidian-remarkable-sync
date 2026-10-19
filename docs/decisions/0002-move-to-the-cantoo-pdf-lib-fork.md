---
type: decision
id: 0002
status: proposed
date: 2026-10-19
domain: architecture
context: home
systems: [obsidian-plugin, pdf-lib, remarkable]
source_repo: github.com/dsebastien/obsidian-remarkable-sync
project: obsidian-remarkable-sync
supersedes: null
related: [0001]
---

# Move to the @cantoo/pdf-lib fork for encrypted sources

## Context

Issue #47. A PhD student's library PDFs synced as the original only, with no `(annotated)` copy, while the device showed highlights and notes on them. Library databases and publishers lock their PDFs with an owner password to restrict copying and printing. Such a file opens in any reader without a prompt, and the reMarkable annotates it normally, but `pdf-lib` 1.17.1 throws `Input document to PDFDocument.load is encrypted` for every encrypted file and offers only `ignoreEncryption`, which loads the object graph without decrypting the streams and produces garbage on save. The plugin caught the error, wrote the original, and showed a notice the user never saw behind the "Processed N pages" notice that followed it.

Reproduced on the maintainers' own device: a three page test PDF locked with `qpdf` (empty user password, owner password set) uploaded through the web app, annotated on a Paper Pro, synced with 2.4.0. Console: the pdf-lib error above, then `could not annotate the source PDF`. Only the original reached the vault.

Upstream `pdf-lib` has had no release since 1.17.1 (2021).

## Options considered

**Keep pdf-lib, implement the standard security handler ourselves.** RC4 40 and 128, AES-128 (R4) and AES-256 (R5/R6) with an empty user password are fully specified, and Web Crypto covers AES-CBC and SHA-256. RC4 and MD5 would have to be written or vendored. Several hundred lines of cryptography in a plugin whose maintainers are not cryptographers, plus the object-level plumbing to decrypt every string and stream as pdf-lib parses them, which pdf-lib's parser does not expose hooks for. Rejected.

**Strip the lock before loading.** The lock is the point: without the key schedule the streams are ciphertext. Not possible.

**`@cantoo/pdf-lib`.** A maintained fork (MIT, version 2.11.1 at the time of writing) with the same API, which added decryption on load (`PDFDocument.load(bytes, { password })`), encryption on save, incremental updates and current TypeScript. Verified in a scratch test and then in specs against fixtures locked with every revision of the standard handler: each loads with `password: ''`, takes a stroke, and saves an unlocked, readable document. A file that needs a real password throws a plain `Error` with the message `NEEDS PASSWORD`, which the plugin reports as such.

## Decision

Replace `pdf-lib` with `@cantoo/pdf-lib`. Load every source PDF with `password: ''` and `updateMetadata: false`. Report failures by reason (`needs-password`, `too-large`, `unreadable`, `save-failed`), each with its own notice, never a combined "may be encrypted or too large".

## Consequences

- The bundle grows from 726 KB to 811 KB (minified, production build).
- The fork depends on bare `fflate`, whose Node entry probes `worker_threads` through `require('module')` at load time, which would stop the plugin loading on mobile under the build's `target: 'node'`. `scripts/build.ts` gained a resolver plugin (`BROWSER_ENTRY_PACKAGES`) that redirects bare `fflate` to `fflate/browser` at bundle time. The production bundle contains no `require` other than `obsidian`, which the build spec pins.
- The fork's ES build imports `fs` in ten files (font and image loading from paths). None survives tree shaking today. The same build spec guards against it reappearing.
- A PDF that needs a real password cannot be opened on the device either, so it never carries annotations. The `needs-password` path exists for completeness and reports clearly instead of guessing.
- Business rules and `docs/configuration.md` updated. ADR 0001 stands: the reasons for adopting pdf-lib over a hand-rolled writer are unchanged, only the maintained line of the library changes.
