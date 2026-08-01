# PDF support

Status: **all three phases implemented. Unreleased, and not yet verified in a live vault.**

1. **Export** a notebook as a single PDF instead of loose per-page images. **Done.**
2. **Sync PDF-backed documents**, keeping the source instead of discarding it. **Done.**
3. **Burn annotations in**, drawing the ink onto the original. **Done.**

## Phases 2 and 3 as built

| Piece                                          | File                                |
| ---------------------------------------------- | ----------------------------------- |
| Retain the source blob, map layers via `redir` | `parser/document-parser.service.ts` |
| Coordinate transform (pure, 16 specs)          | `output/pdf-coordinates.ts`         |
| Draw layers onto the source PDF                | `output/pdf-annotator.service.ts`   |
| Branch source-backed vs notebook output        | `output/document-output.service.ts` |

Verified: `tsc` clean, `lint` 0 warnings, **344 tests** (was 301), build succeeds, bundle 667,674 B.

End to end through the shipped code on the real `resume` fixture:

```
sourceDocument: pdf, 829848 bytes      sourcePageIndexes: [0]
19 strokes, 661 points, 326 ms
created: andrew-doering-resume.pdf, andrew-doering-resume (annotated).pdf
```

The annotated file keeps all 3 pages, preserves the title "Andrew Doering — Resume", carries 684
vector ops on page 0 of which 60 are the translucent highlighter, and leaves the original text
selectable. Visually confirmed: the arrow points at "Senior IT Engineer" and the highlight covers
the intended paragraph.

**Not verified:** `/Rotate` handling is written from the PDF specification, since no available
document has a non-zero rotation. Same for a crop box offset from the media box.

## Phase 1 as built

| Piece                                                                  | File                                 |
| ---------------------------------------------------------------------- | ------------------------------------ |
| PDF assembly over pdf-lib, deterministic                               | `output/pdf-writer.service.ts`       |
| Shared render-and-write loop for cloud sync and `.rmdoc` import        | `output/document-output.service.ts`  |
| `buildDocumentPath`, `writeDocumentPdf`, skip-if-unchanged write guard | `output/markdown-writer.service.ts`  |
| `savePdf` setting                                                      | `types/plugin-settings.intf.ts`      |
| "Save as PDF" toggle                                                   | `settings/components/pdf-section.ts` |

Verified: `tsc` clean, `lint` 0 warnings, **287 tests pass** (was 238), build succeeds.
`dist/main.js` went from 145,385 to 665,121 bytes. Bundle audit clean: pdf-lib added no
`require()`, no `new Worker`, no `createObjectURL`, no `createElement("script")`. The only
`require()` calls remain `obsidian` and the three guarded desktop-only Node builtins.

### Renderer-to-PDF verified in a real browser

The unit suite mocks `renderPage`, because `OffscreenCanvas` does not exist under `bun test`. That
left the join between the plugin's own renderer and the PDF writer untested. Closed by bundling
`page-renderer.service` and `pdf-writer.service` with `bun build --target=browser` and running them
in headless Chrome via Playwright (`channel: 'chrome'`, since the cached Playwright browser build
did not match the installed package).

Real `renderPage()` output, from strokes through `OffscreenCanvas` and `convertToBlob`, fed straight
into `buildPdf`:

| Encoding | Rendered  | Resulting PDF           |
| -------- | --------- | ----------------------- |
| JPEG     | 79,128 B  | 159,721 B (2 pages)     |
| PNG      | 212,786 B | 110,026 B (1 page)      |
| WebP     | 36,730 B  | n/a, falls back to JPEG |

Pages came out 447.29 x 596.39 pt with no `CreationDate`, `ModDate` or `Producer`. Rendering the
result back to an image confirmed correct placement and centring of a page frame, a pressure-varying
ballpoint stroke, a marker stroke, a translucent highlighter and a fineliner, in the right colours
and relative widths.

**Still not covered by this**: strokes came from hand-built `Stroke` objects, not from parsing a real
device `.rm`. The parser is tested separately, and agrees with `rmscene` on the one real file
available.

### Earlier check with synthetic images

On real 1404x1872 JPEGs plus one 1404x2600 page standing in for scrolled content:

- Standard pages come out 447.29 x 596.39 pt, which is 6.21 x 8.28 inches, matching the physical
  reMarkable screen.
- The tall page came out 447.29 x 828.32 pt: same width, proportionally taller, not cropped.
- Two runs a second apart produced byte-identical files.
- Rendered the result back to an image and inspected it: frame, grid and a corner-to-corner
  diagonal all land correctly, so there is no aspect distortion.

**Deviation from this plan, deliberate:** no renderer change was needed. pdf-lib's embedded image
exposes `.width`/`.height`, so `renderPage()`'s existing `ArrayBuffer` feeds straight into
`embedJpg`/`embedPng` and `renderPageDetailed` was never required.

**Open decisions were resolved as recommended:** blank pages and failed pages are both dropped from
the PDF, consistent with the image path, with the existing failure Notice carrying the report. The
`.rmdoc` import now reports failed pages too, which it previously swallowed.

## What existed before this plan

Nothing in the codebase wrote or read a PDF. Verified by reading the pipeline end to end:

- `renderPage()` encodes a page to PNG, JPEG or WebP only.
- `writePageImage()` writes exactly one binary file per page, extension from `settings.imageFormat`.
- `parseDocument()` reads only `.metadata`, `.content` and `.rm` files.

The consequence for PDF-backed documents (imported books and papers) is worth stating plainly:
`downloadDocument()` **does** fetch the `<id>.pdf` blob, because it downloads every entry in the
document index, and then `parseDocument()` drops it on the floor. Such a document currently syncs
as annotation ink floating on blank white pages, or reports "No pages with content found" when it
was never annotated. Phase 1 on its own would make that worse, not better, by wrapping those blank
pages in something that looks like a real document.

## Dependency: pdf-lib

**Decided with the user: take `pdf-lib`, accept the size.**

Phase 3 has to modify an existing PDF, not author a new one. That means walking the original's page
tree, which means parsing its cross-reference data, which for anything from PDF 1.5 onward is
commonly a compressed cross-reference stream with objects packed into object streams. That is a
real PDF reader, and it is exactly what pdf-lib already is.

Measured on pdf-lib 1.17.1 with **Bun 1.3.14's own bundler**, using the exact production settings
from `scripts/build.ts` (`format: 'cjs'`, `target: 'node'`, `minify: true`, `sourcemap: 'none'`):

| Entry point exercised                          | Bundled  | `require()` | Reviewer flags |
| ---------------------------------------------- | -------- | ----------- | -------------- |
| baseline, empty module                         | 0.6 KB   | none        | none           |
| `PDFDocument.load` + `save`                    | 505.3 KB | none        | none           |
| `create` + `embedJpg` + `drawImage`/`drawLine` | 505.5 KB | none        | none           |

Tree-shaking buys nothing. pdf-lib's module graph eagerly pulls the 14 standard-font AFM tables
(about 180 KB), UPNG and pako, none of which a stroke overlay uses. Obsidian ships a single
`main.js`, so a lazy `import()` cannot defer the download cost either.

The current production bundle is **145,385 bytes** (measured, not estimated), so pdf-lib takes it to
roughly 650 KB, about 4.5x. This is a **deliberate, documented exception** to the "keep the plugin
small, avoid large dependencies" guidance in `AGENTS.md`. Accepted because correctness on arbitrary
user PDFs (encrypted, linearized, hybrid-reference, object streams) matters more than the bytes, and
a hand-rolled reader would fail on exactly the files the maintainer cannot reproduce.

Clean on every rule that applies: **zero `require(...)` calls** in the bundled output, so no Node
builtins and no conflict with the mobile business rule, and no `new Worker`, `createObjectURL` or
`createElement("script")` for the catalog reviewer to flag. pdf-lib publishes `main: cjs/index.js`
and `module: es/index.js` with no `browser` field, and since neither entry touches Node builtins the
`fflate/browser` precedent does not apply.

**Validated against real files.** Surveyed the 48 PDFs in the user's
`remarkable/Daily Journal` vault folder (read-only). pdf-lib loaded **48 of 48 with zero failures**,
and every one of them reports `pdf-lib` as its producer, meaning the user's existing
reMarkable-to-PDF tool is already built on this same library. Page geometry in that corpus is all
`rot=0` with the crop box equal to the media box, so it exercises neither the `/Rotate` nor the
`/CropBox` branch of the phase 3 transform. Those still need material from elsewhere.

**Audit done on the real bundle** after wiring: `dist/main.js` contains only `require("obsidian")`
and the three guarded desktop-only Node builtins, with no `new Worker`, `createObjectURL`,
`createElement("script")` or `eval(`. **Still to verify**: the same build under the reviewer's older
Bun (observed 1.2.14).

Taking pdf-lib also **removes** the hand-rolled PDF writer from an earlier draft of this plan. One
PDF path, not two.

---

## Phase 1: notebook to PDF export

### Settings

`imageFormat` cannot absorb `'pdf'`. It drives both the canvas encoder and the output file
extension, and a PDF still needs an image codec inside it. PDF export is its own toggle beside the
existing `saveImages`:

```typescript
savePdf: boolean // default false
```

| `saveImages` | `savePdf` | Result                                  |
| ------------ | --------- | --------------------------------------- |
| true         | false     | today's behaviour, the default          |
| false        | true      | PDF only                                |
| true         | true      | both                                    |
| false        | false     | nothing written, already possible today |

**No settings migration.** A new boolean defaulting to `false` merges cleanly through the existing
`DEFAULT_SETTINGS` path and `saveImages` keeps its exact current meaning. The alternative considered
was folding both into an `outputFormat` enum, which needed a load-time migration and left a "Save
images" toggle next to a dropdown that also offered "Images".

New settings section, `src/app/settings/components/pdf-section.ts`, following the existing
component-per-heading pattern (`auth-section`, `cloud-section`, `output-section`, `sync-section`,
`about-section`). It holds the "Save as PDF" toggle and is where later PDF options land. The
"Output" section keeps the target folder and image settings, which the PDF path shares.

### Building the PDF

`src/app/services/output/pdf-writer.service.ts`, a thin wrapper over pdf-lib:

```
PDFDocument.create()
  → embedJpg(bytes) | embedPng(bytes)   // pdf-lib handles both natively
  → addPage([widthPt, heightPt])
  → page.drawImage(img, { x: 0, y: 0, width, height })
  → doc.save()
```

pdf-lib's embedded image exposes `.width` and `.height`, so **no renderer change is needed**.
`renderPage()`'s existing `ArrayBuffer` feeds straight into `embedJpg`/`embedPng`, and the same
bytes serve the loose image file when both toggles are on, so no page renders twice.

### Determinism and sync churn

pdf-lib stamps `/CreationDate`, `/ModDate` and `/Producer` by default, so two runs of the same
notebook produce different bytes. With automatic sync enabled that would hand a vault sync tool a
"changed" file on every run, for no reason.

`updateMetadata: false` suppresses it entirely, which is better than pinning the dates to a fixed
value. Measured on pdf-lib 1.17.1, hashing the output of two runs a second apart:

| Path                                     | Two runs           |
| ---------------------------------------- | ------------------ |
| `create()` default                       | differ             |
| `create({ updateMetadata: false })`      | **byte-identical** |
| `load()` default                         | differ             |
| `load(bytes, { updateMetadata: false })` | **byte-identical** |

With it off, `create()` emits no `/CreationDate`, `/ModDate`, `/Producer` or `/ID` at all. On the
phase 3 load path it also leaves the **source document's own** metadata untouched: a source with
`Title`, `Author` and a 2020 creation date came back through the overlay with all three intact and
nothing restamped. Left on, pdf-lib overwrites `/Producer` with its own string and bumps `/ModDate`.

So: `updateMetadata: false` on both `create()` and `load()`, and `save({ useObjectStreams: false })`
for stable object ordering.

**Deterministic bytes are only half of it.** `writePageImage()` calls `vault.modifyBinary()`
unconditionally whenever the file already exists, so identical content still rewrites the file,
still bumps its mtime, and still looks like a change to Obsidian Sync, Git or Dropbox. Auto-sync
only processes notebooks marked `needs-sync` or `never-synced`, which limits how often this fires,
but a device can bump `lastModified` for benign reasons such as simply opening a notebook, and then
the pipeline re-runs and rewrites byte-identical output.

Add a skip-if-unchanged guard to the write path: read the existing file, compare length then bytes,
and skip the write when they match. Apply it to `writePageImage()` as well as `writeDocumentPdf()`,
since loose images have exactly the same problem today. The cost is one read per file per re-sync,
which is far cheaper than a needless re-upload of a large PDF.

### Page geometry

reMarkable pages are `PAGE_WIDTH` x `PAGE_HEIGHT` (1404 x 1872) at 226 DPI. PDF user space is
1/72 inch:

```
points = pixels / 226 * 72
```

1404 x 1872 becomes about 447.3 x 596.4 pt. Each page takes its size from its own image, so the
grown canvases `renderPageToCanvas()` produces for scrolled content (issue #3) become taller PDF
pages rather than cropped ones. Rejected: a fixed A4 MediaBox, which would distort or letterbox
since the reMarkable aspect ratio is not A4's.

### Codec matrix

| `imageFormat` | Embedded via                         |
| ------------- | ------------------------------------ |
| `jpeg`        | `embedJpg`, bytes passed through     |
| `png`         | `embedPng`                           |
| `webp`        | re-encoded to JPEG at `imageQuality` |

PDF has no WebP filter. The canvas is still in hand at that point so re-encoding costs one extra
`convertToBlob`. With both toggles on the loose files stay WebP and only the embedded copy differs.
Say so in the settings description rather than letting users discover it.

### Where it lands

```
<targetFolder>/<folderPath>/<notebookName>.pdf
```

Images live in `<targetFolder>/<folderPath>/<notebookName>/<notebookName>-P001.jpg`, so the PDF
sits beside that folder with no collision. Overwrite semantics match images (`modifyBinary` when
present, else `createBinary`). `buildPagePath()` gains a sibling `buildDocumentPath()`, and
`writePageImage()` gains `writeDocumentPdf()`.

Two notebooks sharing a `visibleName` in one folder already collide for images today. Not new, not
addressed here.

### Wiring

`PipelineDeps` gains `writeDocumentPdf`. Both `notebook-pipeline.service.ts` and
`rmdoc-import.service.ts` need it, and the import service currently duplicates the
render-and-write loop rather than sharing it. Factor that loop into one place while wiring this up.

---

## Phase 2: sync PDF-backed documents

### Detection and retention

`content.fileType` is already on `RemarkableDocumentContent`, typed as a bare `string`. Narrow it to
`'notebook' | 'pdf' | 'epub' | (string & {})` and branch on it.

`parseDocument()` keeps the source blob instead of discarding it. New domain fields:

```typescript
// Notebook
sourceDocument?: { data: ArrayBuffer; kind: 'pdf' | 'epub' }
// Page
sourcePageIndex?: number   // absent for pages inserted on the device
```

The source file appears in the file map as `<docId>.pdf`, both from the sync index and inside a
`.rmdoc` archive.

### Page mapping

Firmware 3.x `cPages` entries carry a redirect to the source page number, which is what maps an
annotation layer onto its page. reMarkable also lets you insert new pages into a PDF, and those have
no source page at all.

**Unverified against a real export**, since the only fixture in the repo is synthetic. Fallback if
the redirect is absent: assume page _i_ maps to source page _i_ for the first N pages, and log when
that assumption is used so bug reports say so.

### Blank pages: a rule conflict

The existing rule skips pages with no strokes entirely. For a PDF-backed document a stroke-free page
is **not blank**, it is an un-annotated page of a real book, and skipping it would delete content.
The rule has to be scoped: blank-page skipping applies to notebook pages, never to source-backed
pages. This needs recording in `Business Rules.md` as an amendment, not a new rule bolted alongside.

### Output

```
<targetFolder>/<folderPath>/<notebookName>.pdf              source, written through unmodified
<targetFolder>/<folderPath>/<notebookName> (annotated).pdf  phase 3
```

The plain name carries the source for a PDF-backed document and the assembled export for a
notebook. Those two cases are mutually exclusive, so the names never collide.

EPUB is detected and reported, not converted. reMarkable renders EPUBs to its own layout, so there
is no page-for-page source to draw on. Out of scope.

---

## Phase 3: annotation burn-in

### Approach

```
PDFDocument.load(sourceBytes, { updateMetadata: false })
  → for each annotated page: doc.getPage(sourcePageIndex)
  → transform strokes from .rm space into PDF user space
  → page.pushOperators(...) with the ink as path operators
  → doc.save()  →  "<name> (annotated).pdf"
```

### Prototype result: mechanics solved, placement not

A throwaway overlay was run against the real `resume` fixture. **What it proved works:**

- `PDFDocument.load` handles a real 829 KB device PDF, ink draws onto the correct source page via
  `cPages[i].redir.value`, and all three pages survive into the output (877 KB, 3 pages).
- Per-segment width, colour and highlighter opacity translate cleanly to pdf-lib `drawLine` calls,
  582 segments for 18 strokes.
- The un-annotated pages 1 and 2 pass through untouched, which is the whole point of phase 2.

### Transform SOLVED (one sample, needs a second page size)

The user supplied the missing landmark: the arrow in `resume` should point at "Senior IT Engineer".
`PyMuPDF` puts that text at x 215.9..295.6, PDF y 565.1..574.9 on page 0. The leftmost ink point
(the arrow tip) is at rm (6.2, 835.5). Anchoring one against the other and solving for the offsets
showed the working scale is near **0.318**, not the ~0.42-0.45 both fit-to-screen models predicted.

Reading the solved offsets back gave a clean formula, which then reproduces the correct placement
with **no anchoring at all**:

```
scale  = cropBox.width / 1872          // 595.0 / 1872 = 0.3178
pdfX   = cropBox.x + cropBox.width / 2 + rmX * scale      // x IS centred
pdfY   = cropBox.y + cropBox.height    - rmY * scale      // y measured down from the page top
```

So the original structure in this plan was right (centred x, y flipped from the top). Only the
**scale** was wrong, and the surprise is the denominator: the page width divides by the screen
**height** (1872), not the screen width. Equivalently `(width / 1404) * (1404 / 1872)`, i.e. the
naive width-fit scaled by the screen aspect ratio.

Verified visually: the arrow lands on "Senior IT Engineer", the whole annotation sits on the page,
and pages 1 and 2 pass through untouched. Output at
`~/Desktop/remarkable-test-fixtures/poc-annotated-SOLVED.pdf`.

**Confirmed on a second page size.** The `/1872` denominator was the suspect term, so it was tested
against a US Letter document (612 x 792 pt, aspect 0.7727 against A4's 0.7067). The formula holds:

| Document   | Page size      | Scale  | Ink x span      | Ink y span (from top) |
| ---------- | -------------- | ------ | --------------- | --------------------- |
| resume     | A4 595x841.9   | 0.3178 | 299..562 of 595 | 164..274 of 841.9     |
| journal p0 | Letter 612x792 | 0.3269 | 51..611 of 612  | 85..794 of 792        |
| journal p1 | Letter 612x792 | 0.3269 | 39..589 of 612  | 63..581 of 792        |

Every span lands on the page. The journal case is the more convincing one: ink written across a full
page maps to x 51..611 of 612, filling the width almost exactly, which a wrong scale would either
squeeze into the middle or throw well past the edge. The one overshoot is 2 pt on a 792 pt page
(0.25%), for ink drawn at the very bottom edge.

So the rule generalises: **the page width always spans 1872 rm units**, whatever the page's real
dimensions. That is why the denominator is the screen height rather than its width.

**Still untested:** `/Rotate` non-zero, and a crop box offset from the media box. Every sample so far
is `rot=0` with the two boxes equal. `getting-started` cannot help: its only source-backed page
carries no ink, all eight annotation layers sit on device-inserted pages.

### Superseded: the two fit rules that failed

Both candidate fit rules put the bounding box off the
page:

| Rule       | Scale  | Resulting x span      | Verdict   |
| ---------- | ------ | --------------------- | --------- |
| height-fit | 0.4497 | 300.3 .. 671.1 of 595 | overflows |
| width-fit  | 0.4238 | 300.1 .. 649.5 of 595 | overflows |

The assumption that broke is **x centred on zero**. That holds for the notebook case (and is what
`stroke-renderer.ts` documents), but the resume's ink spans x `6.2 .. 830.7`, entirely positive and
past the 702 half-width. The real notebook is stranger still: x `-53.9 .. 1114.5`, y `-164.2 .. 169.0`.
Ink simply is not confined to the nominal 1404x1872 box, which is exactly why
`renderPageToCanvas` grows its canvas in the first place.

**The missing input is view state, and it is in `.content`:**

```
zoomMode: bestFit          customZoomScale: 1
customZoomCenterX: 0       customZoomCenterY: 936      (= 1872 / 2)
customZoomPageWidth: 1404  customZoomPageHeight: 1872
cPages.pages[0].verticalScroll: 2737.06                 (resume, page 0)
```

`verticalScroll` is the one that matters and the plugin does not read it today.
`RemarkableDocumentContent` already types the `customZoom*` fields and equally ignores them.

**Consequence for the plan:** the transform is not derivable from page geometry, so it cannot be
written as a pure function of `(rmPoint, cropBox, rotate)` as sketched below. It needs per-page view
state as a fourth input. Getting that wrong puts annotations in plausible but incorrect places,
which is worse than not shipping the feature.

**Cheapest way to settle it:** one purpose-made export with ink at known landmarks, for example a
mark in each corner of page 1 and a circle around a specific known word. Two or three such samples
pin the transform exactly and turn it back into a unit-testable pure function.

Prototype output kept at `~/Desktop/remarkable-test-fixtures/poc-annotated-*.pdf` for comparison.

### Coordinate mapping

This is the part that will be wrong first, and the part with no way to verify it here.

- **.rm space**: x runs roughly `-PAGE_WIDTH/2` to `+PAGE_WIDTH/2` (x-origin is the page centre, see
  the comment in `stroke-renderer.ts`), y runs 0 downward to `PAGE_HEIGHT`.
- **PDF space**: origin bottom-left, y increases upward, units are points.

So y flips and x re-centres:

```
pdfX = cropBoxOriginX + cropBoxWidth / 2 + rmX * scale
pdfY = cropBoxOriginY + cropBoxHeight - rmY * scale
```

Three things the naive formula above ignores and the implementation must not:

- **`/CropBox` versus `/MediaBox`.** The device fits the crop box, not the media box, and they
  differ on plenty of real PDFs.
- **`/Rotate`.** Values of 90, 180 and 270 are common in scanned material and change which axis is
  which.
- **The device's fit scale.** `scale` is whatever factor reMarkable used to fit the source page into
  its viewport, preserving aspect ratio. The exact rule needs confirming against a real export
  rather than deriving from first principles.

Isolate all of this in one pure function with its own spec. It is the single highest-risk piece of
the whole plan and it is fully unit-testable once the rule is known.

### Drawing the strokes

Reuse the existing pen constants verbatim (`STROKE_COLOR_MAP`, `PEN_WIDTH_MULTIPLIER`,
`HIGHLIGHTER_PEN_TYPES`, `ERASER_PEN_TYPES`) so vector output matches the raster renderer.

`stroke-renderer.ts` draws each segment as its own line with the average of the two endpoint widths,
round cap and join. Eraser strokes are already skipped by the renderer and are skipped here too,
which preserves parity.

**A working reference encoding already exists.** The user's existing tool writes vector ink into
pdf-lib documents, and its output is readable in the vault. Decompressing a page content stream from
`remarkable/Daily Journal/2026-01-15.pdf` shows the shape to copy:

```
0.0 0.0 349.136 1651.4275 re W n      clip to the page
1 0 0 -1 0 1651.42747 cm              the y-flip, exactly as planned above
0 0 0 RG  /a0 gs  1 J  0 j            colour, ExtGState, round cap, miter join
0.60075 w  q 1 0 0 1 0 0 cm           width for this run
47.711 476.762 m  47.703 476.805 l …  a run of points at that width
S Q
```

Operator counts on that page: 5057 `m`, 22567 `l`, 5013 `w`, 5064 `q`/`Q`. So it emits **one
subpath per width run** at roughly 4.5 points each, not one path per segment. Worth copying: the
naive per-segment approach the raster renderer uses would roughly quadruple the operator count for
identical output. Note it uses round cap with **miter** join (`1 J 0 j`), and `/a0 gs` confirms
ExtGState is the right mechanism for the highlighter alpha.

**Highlighter** is the awkward case. The canvas path uses `globalAlpha = 0.3` with
`globalCompositeOperation = 'multiply'`. The PDF equivalent is an ExtGState resource carrying
`/ca 0.3 /CA 0.3 /BM /Multiply`, registered on the page and selected with `gs`. If wiring that
through pdf-lib's resource handling proves awkward, fall back to plain constant alpha without the
blend mode and accept a slightly different look over highlighted text.

### Failure modes to handle explicitly

- **Encrypted source PDF.** pdf-lib throws on load. `ignoreEncryption: true` "succeeds" and then
  produces garbage, so do not reach for it. Detect, report clearly, and write the source through
  unmodified so the user still gets their document.
- **Missing or out-of-range source page index.** Skip that overlay, count it, report it, rather than
  drawing ink onto the wrong page.
- **Memory.** The source bytes, pdf-lib's parsed object graph and the serialized output are all live
  at once. A large scanned textbook is plausibly tens of megabytes and this is a real risk on
  phones. Add a source-size guard that warns above a threshold rather than silently failing.

---

## Highlights arrive as strokes, not as `.highlights`

The user highlighted text on the device and re-synced. Re-fetching the resume's document index
showed it changed (`.rm` 10,673 → 12,563 bytes, `.content` and `.metadata` hashes moved, `.pdf`
unchanged) but the file list is **still exactly five entries, with no `.highlights`**.

The new content is a single `HighlighterV2` stroke, colour 9, 61 points, spanning rm
x `-229..536`, y `1916..2294`. So on this firmware the highlighter tool produces **ink**, and the
`.highlights` JSON path is not being used at all.

Two consequences:

1. **The colour-9 fix was load-bearing.** Without it this stroke renders as a wide opaque black bar
   across the text it highlights, which is exactly the bug found on the notebook.
2. **It independently confirms the transform.** Its y extends to 2294, well past 1872. Under the old
   height-fit model that lands at 1032 on an 841.9 pt page, off the bottom entirely. Under
   `scale = width / 1872` it maps to y 609..729 of 841.9 and x 225..468 of 595, which is where it
   sits on the page. This was a genuine out-of-sample prediction: the stroke was drawn after the
   formula was fixed, and it fits.

It also pins the implied page size in rm units: width 1872 by height `1872 / aspect` = 2649 for A4.
Ink can and does legitimately exceed 1872 in y.

Fixture at `~/Desktop/remarkable-test-fixtures/resume-v2-with-highlight.rmdoc`, rendered result at
`poc-annotated-WITH-HIGHLIGHT.pdf`.

## Text highlights: not present, so not exportable

reMarkable stores **text** highlights (select text, then highlight) separately from highlighter
**strokes**, as `<docId>.highlights/<pageUuid>.json` entries in the document index. They carry the
selected text and its rectangles, which would make them extractable as real text rather than ink.

A scan of the whole account found **zero documents with any `.highlights` entry**. The raw index for
`resume` is exactly five files: `.content`, `.metadata`, `.pagedata`, `.pdf`, and one `.rm`.

So there is nothing to export today. Either no text highlight has ever been made on this account, or
the device is not syncing them. One experiment distinguishes the two: highlight text in a PDF on the
device, sync, and re-scan for a `.highlights` entry. If they appear, they are a far better source
than ink for any "highlights to markdown" feature, because the text comes out as text.

Highlighter _strokes_ are unaffected and do sync: the real `Notebook` fixture contains one, and it
is what exposed the unmapped-colour-9 bug.

## Decisions, all settled

- Separate "Save as PDF" toggle rather than an output-format enum, so `saveImages` keeps its exact
  meaning and no settings migration is needed.
- pdf-lib rather than a hand-rolled writer.
- Blank pages and failed pages are dropped from the PDF, matching the image path. Revisit only on
  user feedback. A placeholder page carrying explanatory text would need an embedded font, though
  pdf-lib makes that cheap now that the standard fonts are in the bundle whether used or not.

Each is recorded above with its rejected alternative.

## Implementation steps

**Phase 1 — done**, except confirming the build under the reviewer's older Bun.

**Phase 2**

1. Narrow `fileType`, retain the source blob in `parseDocument()`, add `sourceDocument` and
   `sourcePageIndex` to the domain types.
2. Page-mapping function plus spec, including the no-redirect fallback.
3. Scope the blank-page rule to notebook pages and amend `Business Rules.md`.
4. Write the source PDF through to the vault.

**Phase 3**

1. Coordinate transform as a pure function, with its own spec, before anything draws.
2. Stroke-to-PDF-operator emitter reusing the pen constants.
3. Overlay assembly, encrypted-PDF detection, size guard.

**Throughout**: `Architecture.md` (service table, data flow), `Domain Model.md` (settings, new
fields), `Business Rules.md`, `README.md`, `docs/configuration.md`, `docs/usage.md`,
`docs/release-notes.md`, and the day's history file.

## Business rules to record

- PDF export is opt-in via `savePdf` (default false), independent of `saveImages`. Either, both or
  neither may be enabled.
- Generated PDFs carry no creation date, modification date, producer or file ID (`updateMetadata:
false`), so re-processing an unchanged notebook produces byte-identical output. On the burn-in
  path the source document's own metadata is preserved unchanged rather than restamped.
- Vault writes skip the write entirely when the new bytes match the existing file, so an unchanged
  page or document never bumps its mtime. Applies to images and PDFs alike, and matters most with
  automatic sync enabled.
- PDF page size derives from the rendered image at 226 DPI, so scrolled pages produce taller pages
  rather than cropped ones.
- WebP cannot be embedded in a PDF and is re-encoded to JPEG at the configured quality. Loose WebP
  files are unaffected.
- Blank-page skipping applies to notebook pages only. A stroke-free page of a PDF-backed document is
  an un-annotated source page and is always retained.
- For PDF-backed documents the source PDF is written through unmodified at `<name>.pdf`. The
  annotated copy is a separate file at `<name> (annotated).pdf`, never an in-place edit.
- An encrypted source PDF is reported and passed through unmodified. Annotations are not burned in.
- `pdf-lib` is a documented exception to the small-dependency guidance, accepted for correctness on
  arbitrary user PDFs.

## Testing

pdf-lib carries the format correctness, so specs target our own logic:

- **Coordinate transform** (phase 3, highest value): known .rm point to known PDF point, across
  `/Rotate` 0/90/180/270, and with a `/CropBox` offset from the `/MediaBox`.
- **Page mapping** (phase 2): cPages with redirects, without redirects, with device-inserted pages
  interleaved.
- **Codec matrix** (phase 1): each `imageFormat` reaches the right embed call, WebP routes through
  the JPEG fallback.
- **Determinism** (phase 1): the same notebook produces byte-identical output twice, and the same
  holds for the burn-in path over a fixed source PDF.
- **Skip-if-unchanged**: an identical re-write calls neither `modifyBinary` nor `createBinary`, a
  changed one still writes, and a first write still creates.
- **Output paths**: notebook export, source passthrough and annotated copy never collide.
- **Toggle combinations**: all four `saveImages` x `savePdf` states call the expected writers.
- **Round-trip** (phase 3): author a small PDF with pdf-lib inside the spec, overlay a known stroke,
  reload and assert the page content stream carries the expected operators.

## Manual verification needed

Not self-verifiable. No live vault, no GUI, no device.

- Open generated PDFs in Obsidian's PDF viewer, in Preview on macOS, and in a browser. Three
  readers, because a structural mistake is often tolerated by one and rejected by another.
- Page order matches the notebook, including one reordered on the device.
- Scrolled content produces a taller page, not a cropped one.
- All three `imageFormat` values with `savePdf` on, confirming the WebP fallback is readable.
- Both toggles on: PDF and loose images both written, neither overwriting the other.
- Re-sync an unchanged notebook with automatic sync on, then confirm the vault file's mtime did not
  move and no sync tool reports a change.
- **Phase 3 alignment**: ink lands exactly where it does on the device, on a portrait page, a
  landscape page, a page with `/Rotate` set, and a scanned page whose crop box differs from its
  media box.
- Highlighter over text looks right, not like an opaque bar.
- Un-annotated pages of a book survive into the output.

## Blocking gap: no real fixture

`src/app/services/import/__fixtures__/sample.rmdoc` is synthetic and contains no PDF-backed
document. Nothing in the repo exercises a genuine reMarkable export, which already limited `.rmdoc`
import (see `mobile-support.md`) and is now the **single largest risk in this plan**, because the
phase 3 coordinate mapping cannot be derived confidently from first principles.

**`rmc` / `rmscene` are installed locally** (`rmc` 0.3.0, `rmscene` 0.6.1) and are useful references,
but they do not close this gap. They are _readers_, not a source of device data.

What they do give:

- **Independent confirmation of the phase 1 geometry.** `rmc/exporters/svg.py` declares
  `SCREEN_WIDTH = 1404`, `SCREEN_HEIGHT = 1872`, `SCREEN_DPI = 226`, `SCALE = 72.0 / SCREEN_DPI`,
  `X_SHIFT = PAGE_WIDTH_PT // 2`. Identical to what `pdf-writer.service.ts` implements, derived
  separately.
- **A richer pen model for the phase 3 vector emitter.** `rmc/exporters/writing_tools.py` has a
  `Pen` class hierarchy with per-segment width, colour and opacity as functions of speed, direction
  and pressure (e.g. Ballpoint's
  `(0.5 + pressure/255) + (width/4) - 0.5*((speed/4)/50)`, Fineliner's `base_width * 1.8`).
  This plugin currently uses a flat `PEN_WIDTH_MULTIPLIER` lookup, so this is a reference for
  improving the raster renderer too, not only for the PDF overlay.
- **A trusted differential-test oracle.** `rmscene` parses v6 into a scene tree, so it can check
  this plugin's `rm-file-parser` on real files rather than synthetic fixtures.

What they do not give:

- **`rmc` does not overlay onto a source PDF at all.** `rmc/exporters/pdf.py` converts `.rm` to SVG
  and then shells out to Inkscape. The upstream that does merge annotations onto original PDFs is
  `maxio` (credited in that file's docstring), which is the better reference for phase 3.
- No annotated PDF-backed document to test the transform against.

**One real `.rm` was found and used**: `~/github/remarkable-daily-journal/assets/blank-page.rm`.
`rmscene` reads it as 8 blocks with no stroke content, and this plugin's `parseRmFile` agrees (0
strokes, `pageHasContent` false). First time the parser has been checked against a genuine device
file rather than a synthetic fixture. It is a blank page, so it does not exercise stroke decoding.

**RESOLVED.** Real documents were pulled from the user's own reMarkable cloud account by reusing the
plugin's `sync-protocol.ts` and `cloud-urls.ts` outside Obsidian, with `requestUrl` stubbed onto
`fetch`. Read-only, and nothing was written back to `data.json`.

Fixtures now live outside the repo at `~/Desktop/remarkable-test-fixtures/` (kept out of git: two of
them are personal). Account shape: 118 documents, 75 `notebook`, 42 `pdf`, 1 `epub`.

| Fixture                 | Shape                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `notebook-real.rmdoc`   | Handwritten notebook, 38 strokes, 918 points, `P Lines medium` |
| `resume.rmdoc`          | **3-page A4 PDF, ink on source page 0** — the phase 3 fixture  |
| `getting-started.rmdoc` | 1-page source PDF + 8 device-inserted pages                    |
| `pdf-backed.rmdoc`      | 2 source pages + 1 inserted page, no ink                       |

**Page mapping confirmed against real data**, exactly as this plan hypothesised: `cPages[i].redir.value`
holds the source page index, and device-inserted pages have **no `redir` at all**. `getting-started`
shows the mixed case (page 0 `redir=0`, pages 1-8 `redir=None`); `resume` shows the clean case
(`redir` 0, 1, 2).

**Phase 3 transform inputs, measured on `resume`:** source pages are A4, 595.0 x 841.9 pt, `rot=0`,
crop box equal to media box. Aspect 0.7067 against reMarkable's 0.7500, so the two do not match and
the fit rule is decidable: width-fitted gives scale 0.4238, height-fitted gives 0.4497. Overlaying
the known ink at both and seeing which aligns with the page content settles it empirically.

**The gap, demonstrated.** Run through the current pipeline, `resume` produces a single page of ink
on white: the annotation reads "← Needs improvement" with an arrow pointing at blank space, because
the 829 KB source PDF was downloaded and discarded. Pages 1 and 2, which have no ink, vanish
entirely.

**Superseded** (kept for the reasoning): `remarkable/Daily Journal` in the user's vault holds 48 PDFs, but they
are _outputs_ of a separate reMarkable-to-PDF tool, not raw device exports. They carry no `.rm`
stroke layers and no source-PDF-plus-annotation pairing, so they cannot validate the transform. They
did validate the dependency (48/48 load) and supplied the reference encoding above, which is why
they were worth surveying.

**Still needed from the user**: a real `.rmdoc` export of a PDF-backed document with a few
annotations on known parts of the page, ideally including one rotated or non-A4 page. Everything
else in phase 3 can be built without it, but the transform cannot be confirmed correct without one.

## Baseline

Bun 1.3.14 installed (matching the `packageManager` pin). Verified clean before any PDF work, the
first local verification this repo has had:

| Check           | Result                                 |
| --------------- | -------------------------------------- |
| `bun run tsc`   | clean                                  |
| `bun run lint`  | 0 warnings                             |
| `bun test`      | 238 pass, 0 fail, 27 files             |
| `bun run build` | succeeds, `dist/main.js` 145,385 bytes |
