# PDF support

Status: **planned, not started.**

Three phases, each shippable on its own:

1. **Export** a notebook as a single PDF instead of loose per-page images.
2. **Sync PDF-backed documents** properly, keeping the source PDF instead of discarding it.
3. **Burn annotations in**, producing the original document with the ink drawn on top.

Phase 2 is a hard prerequisite for phase 3. Phase 1 is independent and lands first because it is
the smallest and shares the dependency.

## What exists today

Nothing in the codebase writes or reads a PDF. Verified by reading the pipeline end to end:

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

Measured against pdf-lib 1.17.1, bundled with esbuild using the same shape as `scripts/build.ts`
(`--bundle --format=cjs --platform=node --minify`):

| Entry point exercised                        | Minified bundle |
| -------------------------------------------- | --------------- |
| `PDFDocument.load` + `save` only             | 500.2 KB        |
| plus `pushOperators`                         | 500.3 KB        |
| plus `drawSvgPath`                           | 500.3 KB        |

Tree-shaking buys nothing. pdf-lib's module graph eagerly pulls the 14 standard-font AFM tables
(about 180 KB), UPNG and pako, none of which a stroke overlay uses. Obsidian ships a single
`main.js`, so a lazy `import()` cannot defer the download cost either.

Against a current bundle of roughly 129 KB this is about a 5x increase, and it is a **deliberate,
documented exception** to the "keep the plugin small, avoid large dependencies" guidance in
`AGENTS.md`. Accepted because correctness on arbitrary user PDFs (encrypted, linearized,
hybrid-reference, object streams) matters more than the bytes, and a hand-rolled reader would fail
on exactly the files the maintainer cannot reproduce.

Checked and clean: the bundled output contains **zero `require(...)` calls**, so no Node builtins,
no conflict with the mobile business rule, and no worker or blob-URL machinery for the catalog
reviewer to flag. pdf-lib publishes `main: cjs/index.js` and `module: es/index.js` with no `browser`
field, and since neither entry touches Node builtins the `fflate/browser` precedent does not bite.

**Still to verify before merging**, because the measurement above used esbuild (Bun is not
installed on the current machine):

- Same result under Bun's bundler, and under the reviewer's pinned Bun 1.2.14.
- `dist/main.js` audit for `require(...)`, `createElement("script")`, `new Worker` and
  `createObjectURL`, per the existing business rule.

Taking pdf-lib also **removes** the hand-rolled PDF writer from an earlier draft of this plan. One
PDF path, not two.

---

## Phase 1: notebook to PDF export

### Settings

`imageFormat` cannot absorb `'pdf'`. It drives both the canvas encoder and the output file
extension, and a PDF still needs an image codec inside it. PDF export is its own toggle beside the
existing `saveImages`:

```typescript
savePdf: boolean   // default false
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

**Determinism.** pdf-lib stamps `/CreationDate`, `/ModDate` and `/Producer` by default, which would
make every re-sync rewrite the file and churn any vault sync tool. Pin them: `setCreationDate` and
`setModificationDate` to a fixed epoch, fixed producer string, and `save({ useObjectStreams: false })`
for stable output.

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

| `imageFormat` | Embedded via                          |
| ------------- | ------------------------------------- |
| `jpeg`        | `embedJpg`, bytes passed through      |
| `png`         | `embedPng`                            |
| `webp`        | re-encoded to JPEG at `imageQuality`  |

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
the redirect is absent: assume page *i* maps to source page *i* for the first N pages, and log when
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
round cap and join. The PDF equivalent is per-segment `m`/`l`/`S` with `w` set per segment, plus
`J 1` and `j 1`. Eraser strokes are already skipped by the renderer and are skipped here too, which
preserves parity.

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

## Open decisions

1. **Failed pages in an exported PDF (phase 1).** Today a page that fails to render is dropped and
   counted, and the Notice reports "N pages failed to render". In a PDF, dropping silently shifts
   every later page number. Options: drop (consistent with images, recommended, the Notice already
   reports it), or insert a blank placeholder. A placeholder carrying explanatory text needs an
   embedded font, though pdf-lib now makes that cheap since the standard fonts are already in the
   bundle whether used or not.
2. **Blank notebook pages in an exported PDF (phase 1).** The existing rule skips them. Arguable for
   a PDF, where a document with holes reads oddly. Recommendation is to keep the rule and revisit on
   feedback. Distinct from the phase 2 rule conflict above, which is not optional.

Settled: separate "Save as PDF" toggle rather than an output-format enum. pdf-lib rather than a
hand-rolled writer. Both recorded above with their rejected alternatives.

## Implementation steps

**Phase 1**

1. Add `pdf-lib`, then audit `dist/main.js` for `require(...)`, `createElement("script")`,
   `new Worker`, `createObjectURL`, and confirm the size under Bun and under Bun 1.2.14.
2. `pdf-writer.service.ts` plus spec: build a PDF from a list of encoded images, deterministic bytes.
3. `buildDocumentPath()` and `writeDocumentPdf()` in `markdown-writer.service.ts`.
4. `savePdf: false` in `plugin-settings.intf.ts` and `DEFAULT_SETTINGS`.
5. Extract the shared render-and-write loop, wire it into the pipeline and the `.rmdoc` import.
6. `pdf-section.ts` with the toggle, registered in `settings-tab.ts`, plus a revised image-format
   description naming the WebP fallback.

**Phase 2**

7. Narrow `fileType`, retain the source blob in `parseDocument()`, add `sourceDocument` and
   `sourcePageIndex` to the domain types.
8. Page-mapping function plus spec, including the no-redirect fallback.
9. Scope the blank-page rule to notebook pages and amend `Business Rules.md`.
10. Write the source PDF through to the vault.

**Phase 3**

11. Coordinate transform as a pure function, with its own spec, before anything draws.
12. Stroke-to-PDF-operator emitter reusing the pen constants.
13. Overlay assembly, encrypted-PDF detection, size guard.

**Throughout**: `Architecture.md` (service table, data flow), `Domain Model.md` (settings, new
fields), `Business Rules.md`, `README.md`, `docs/configuration.md`, `docs/usage.md`,
`docs/release-notes.md`, and the day's history file.

## Business rules to record

- PDF export is opt-in via `savePdf` (default false), independent of `saveImages`. Either, both or
  neither may be enabled.
- Exported PDFs carry pinned creation and modification dates, so re-syncing an unchanged notebook
  produces identical bytes.
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
- **Determinism** (phase 1): the same notebook produces byte-identical output twice.
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
- Re-sync unchanged: PDF bytes identical.
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

**Needed from the user**: a real `.rmdoc` export of a PDF-backed document with a few annotations on
known parts of the page, ideally including one rotated or non-A4 page. Everything else in phase 3
can be built without it, but the transform cannot be confirmed correct without one.

## Tooling gap

Bun is not installed on the current machine (`bun` is not on `PATH`), so `bun run tsc`,
`bun run lint`, `bun test` and `bun run build` cannot run here. The definition of done in
`AGENTS.md` requires all four. Install Bun before implementation starts.
