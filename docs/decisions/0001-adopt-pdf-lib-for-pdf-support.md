---
type: decision
id: 0001
status: accepted
date: 2026-08-01
domain: architecture
context: home
systems: [obsidian-plugin, pdf-lib, remarkable]
source_repo: github.com/dsebastien/obsidian-remarkable-sync
project: obsidian-remarkable-sync
---

# Adopt pdf-lib for PDF support

## Context

The plugin rendered reMarkable pages to loose images only. Three related gaps:

1. No PDF export at all.
2. PDF-backed documents (imported books, papers) were broken in a non-obvious way.
   `downloadDocument()` fetched the source `.pdf` blob and `parseDocument()` discarded it, so an
   annotated paper synced as ink floating on blank white pages. The ink was real, the document
   was gone.
3. Text highlights made on the device were not surfaced anywhere.

Fixing (2) means **modifying an existing PDF**, not authoring one. That requires walking the
original's page tree, which for anything from PDF 1.5 onward means parsing compressed
cross-reference streams and object streams.

## Options considered

**Hand-rolled minimal PDF writer.** Was the initial recommendation, on an estimate of ~380 KB for
pdf-lib. An image-only PDF is genuinely small: JPEG embeds as `/DCTDecode` untouched, and `fflate`
(already bundled) supplies the deflate for a lossless path. Roughly 20 KB.

Rejected once annotation burn-in entered scope. Authoring a PDF is a small serializer; _reading and
modifying_ one is a real PDF reader. A hand-rolled version fails on exactly the files a maintainer
cannot reproduce: encrypted, linearized, hybrid-reference.

**pdf-lib.** Measured rather than estimated, under Bun 1.3.14 with the production settings from
`scripts/build.ts`:

| Entry point exercised           | Bundled  |
| ------------------------------- | -------- |
| baseline, empty module          | 0.6 KB   |
| `PDFDocument.load` + `save`     | 505.3 KB |
| `create` + `embedJpg` + drawing | 505.5 KB |

Tree-shaking buys nothing: the module graph eagerly pulls 14 standard-font AFM tables (~180 KB),
UPNG and pako regardless of what is imported. Obsidian ships a single `main.js`, so a lazy
`import()` cannot defer the cost either.

**Bundling pdf.js** (for text extraction, to infer highlights from ink geometry). Rejected: ~1 MB
plus a worker and blob URL, both flagged by the community-plugin reviewer. Became moot when text
highlights turned out to be stored directly in the `.rm` file.

## Decision

Adopt **pdf-lib 1.17.1**, accepting ~505 KB against a 145 KB bundle (about 4.5x, taking
`dist/main.js` to ~670 KB).

Recorded as a **deliberate, documented exception** to the "keep the plugin small, avoid large
dependencies" guidance in `AGENTS.md`.

Corroborating evidence: a survey of 48 real PDFs from the user's vault loaded 48/48 with zero
failures, and every one reported `pdf-lib` as its producer — the user's existing
reMarkable-to-PDF tooling is already built on it.

## Consequences

**Accepted cost.** Bundle grows 4.5x. If only notebook-to-PDF export were wanted, this is a bad
trade and the ~20 KB hand-rolled writer would have been correct.

**Compliance is clean.** Zero `require(...)` in the bundled output, so no Node builtins and no
conflict with the mobile business rule. No `new Worker`, `createObjectURL` or
`createElement("script")` for the catalog reviewer to flag.

**Unlocked.** Deterministic output via `updateMetadata: false` (byte-identical across runs, so
re-syncs do not churn vault sync), source metadata preserved on the annotate path, and real
`/Highlight` annotations rather than painted ink.

**Still unverified.** The build under the reviewer's older pinned Bun (observed 1.2.14) has not
been checked.
