# PDF export

Status: **planned, not started.**

Add PDF as an output format. A synced notebook can produce one PDF file instead of (or alongside)
the loose per-page images it produces today.

## What exists today

Nothing in the codebase writes or reads a PDF. Confirmed by reading the pipeline end to end:

- `renderPage()` encodes a page to PNG, JPEG or WebP only.
- `writePageImage()` writes exactly one binary file per page, extension taken from
  `settings.imageFormat`.
- `parseDocument()` looks only at `.metadata`, `.content` and `.rm` files.

Two consequences worth stating plainly, because they are easy to assume otherwise:

1. **There is no PDF export.** Output is always N image files per notebook.
2. **There is no annotation-over-PDF.** For a PDF-backed reMarkable document (an imported book or
   paper), `downloadDocument()` does fetch the `<id>.pdf` blob along with everything else in the
   index, and then `parseDocument()` throws it away. Such a document currently syncs as
   annotation ink floating on blank white pages, or reports "No pages with content found" when
   nothing was annotated. That gap is real but **out of scope here**, see
   [Out of scope](#out-of-scope).

## Goal

`Notebook → rendered page images → one PDF in the vault`, reusing the existing renderer verbatim
so the visual result matches what the plugin already produces.

## Design

### Output format setting

`imageFormat` cannot absorb `'pdf'`. It drives both the canvas encoder and the output file
extension, and a PDF still needs an image codec inside it. Add a separate setting:

```typescript
outputFormat: 'images' | 'pdf' | 'both' | 'none'
```

`imageFormat` keeps its current meaning and additionally selects the codec embedded in the PDF.

**Folds in `saveImages`.** Two independent switches ("Save images" toggle plus an output-format
dropdown that itself offers "Images") is a confusing settings tab. `saveImages: false` migrates to
`outputFormat: 'none'` on load, the toggle is removed, and `saveImages` stays in the interface as a
legacy read-once field (legacy, not `@deprecated`, per the catalog rule about intentionally-read
legacy shapes). Default is `'images'`, so existing installs see no behaviour change.

### Where the PDF is written

```
<targetFolder>/<folderPath>/<notebookName>.pdf
```

Images already live in `<targetFolder>/<folderPath>/<notebookName>/<notebookName>-P001.jpg`, so the
PDF sits beside that folder with no collision, and `'both'` works without extra rules. Overwrite
semantics match images (`modifyBinary` when the file exists, otherwise `createBinary`). Two
notebooks sharing a `visibleName` in one folder already collide for images today, so that is not
new and is not addressed here.

`buildPagePath()` gets a sibling `buildDocumentPath()` in `markdown-writer.service.ts`, and a
`writeDocumentPdf()` alongside `writePageImage()`.

### How the PDF is built

New `src/app/services/output/pdf-writer.service.ts`, a minimal PDF 1.4 serializer. One image
XObject per page, no text, no fonts.

```
%PDF-1.4 + binary comment line
1  Catalog        << /Type /Catalog /Pages 2 0 R >>
2  Pages          << /Type /Pages /Kids [...] /Count N >>
per page:
   Page           << /Type /Page /Parent 2 0 R /MediaBox [0 0 W H]
                     /Resources << /XObject << /Im0 <n> 0 R >> >> /Contents <n> 0 R >>
   Contents       stream: "q W 0 0 H 0 0 cm /Im0 Do Q"
   Image XObject  << /Subtype /Image /Width px /Height px /ColorSpace /DeviceRGB
                     /BitsPerComponent 8 /Filter <filter> /Length n >>
xref + trailer << /Size n /Root 1 0 R >> + startxref + %%EOF
```

No `/Info` dictionary and no `/CreationDate`, so the same notebook serializes to identical bytes
every run. That keeps specs deterministic and stops a re-sync from churning the file for vault
sync tools.

Interface:

```typescript
interface PdfPageImage {
    data: ArrayBuffer      // encoded image bytes
    widthPx: number
    heightPx: number
    filter: 'DCTDecode' | 'FlateDecode'
}

createPdfBuilder(): { addPage(image: PdfPageImage): void; finish(): ArrayBuffer }
```

The builder holds only encoded page bytes, never canvases, and concatenates once in `finish()`.

### Dependency decision (needs sign-off)

**Recommendation: hand-roll the writer, add no dependency.**

`pdf-lib` is the obvious library choice and it is a poor fit here. It is roughly 380 KB minified
against a current bundle of about 129 KB, and most of that weight is standard-font AFM data this
feature never touches. An image-only PDF is a genuinely small format problem: a JPEG embeds as
`/DCTDecode` with its bytes passed through unmodified, and the lossless path needs a zlib stream,
which `fflate` already provides (`zlibSync`) and is already bundled and already blessed by the
`fflate/browser` business rule. No new dependency means nothing new to audit in `dist/main.js` for
`require()`, `new Worker` or `createObjectURL`.

Cost of hand-rolling is the xref byte-offset arithmetic, which is mechanical and directly testable.

### Page geometry

reMarkable pages are 1404x1872 px at 226 DPI. PDF user space is 1/72 inch, so:

```
points = pixels / 226 * 72
```

1404x1872 becomes about 447.3 x 596.4 pt. Each PDF page takes its MediaBox from its own image, so
the grown canvases that `renderPageToCanvas()` produces for scrolled content (issue #3) become
proportionally taller PDF pages rather than being cropped or squashed.

Rejected: forcing a fixed A4 MediaBox. The reMarkable aspect ratio is not A4's, so it would either
distort or letterbox, and it would defeat the variable-height canvas.

### Codec matrix

| `imageFormat` | Embedded in the PDF                  | Filter        |
| ------------- | ------------------------------------ | ------------- |
| `jpeg`        | the encoded JPEG bytes, untouched    | `DCTDecode`   |
| `png`         | raw RGB scanlines from the canvas, deflated with `fflate.zlibSync` | `FlateDecode` |
| `webp`        | re-encoded to JPEG at `imageQuality` | `DCTDecode`   |

PDF has no WebP filter, so WebP must be re-encoded. The canvas is still in hand at that point, so
it costs one extra `convertToBlob`. Under `'both'` the loose files stay WebP and only the embedded
copy differs. This must be called out in the settings description, not left as a surprise.

The PNG path deliberately does **not** embed PNG file bytes. `FlateDecode` expects raw scanline
data, not a PNG container, so this path pulls `ImageData` from the canvas, drops the alpha channel
(pages are painted onto an opaque white fill), and deflates the RGB triples.

### Renderer seam

`renderPage()` returns only an `ArrayBuffer`, which is not enough: the PDF needs pixel dimensions,
and the lossless path needs the canvas itself. Under `'both'` a naive implementation would also
render every page twice.

Add to `page-renderer.service.ts`:

```typescript
interface RenderedPage {
    data: ArrayBuffer
    format: 'png' | 'jpeg' | 'webp'
    widthPx: number
    heightPx: number
    toRgb(): Uint8Array   // lazy, for the FlateDecode path
}

renderPageDetailed(page, format, quality): Promise<RenderedPage | null>
```

`renderPage()` becomes a thin wrapper over it, so existing callers and specs do not churn.
`renderPageToCanvas()` is called once per page and both outputs derive from that one canvas.

`PipelineDeps` gains `renderPageDetailed` and `writeDocumentPdf`. Both the cloud pipeline and
`rmdoc-import.service.ts` need the same wiring, and the import service currently duplicates the
render-and-write loop rather than sharing it. Factor the loop into one place while wiring this up.

### Platform and compliance

- `isPageRenderingSupported()` still gates everything. PDF assembly is pure byte manipulation and
  adds no new platform requirement.
- No Node builtins, no worker, no blob URL, no dynamic script element. Nothing new for the catalog
  reviewer to flag.
- Vault writes go through `vault.createBinary` / `modifyBinary` exactly as images do.

### Memory

The whole PDF is assembled in memory before the single vault write. A 200-page notebook at JPEG
quality 0.85 lands somewhere around 40 to 60 MB. Sequential rendering means only one canvas is
alive at a time, so the encoded-bytes array is the ceiling. Acceptable on desktop, unmeasured on
phones. Streaming the PDF would mean writing incrementally to the vault, which Obsidian's vault API
does not support, so the mitigation if reports come in is a page-count warning rather than a
redesign.

## Open decisions

1. **Fold `saveImages` into `outputFormat`, or keep both?** Recommendation is to fold, with the
   migration above. Keeping both avoids a settings migration at the cost of a confusing tab.
2. **Failed pages in a PDF.** Today a page that fails to render is dropped and counted, and the
   Notice reports "N pages failed to render". In a PDF, dropping silently shifts every later page
   number. Options: drop (consistent with images, recommended, the Notice already reports it), or
   insert a blank placeholder page. A placeholder with explanatory text would need an embedded
   font, which reintroduces the weight this design avoids.
3. **Blank pages in a PDF.** Existing rule skips them entirely. That is right for loose images and
   arguable for a PDF, where a document with holes in it reads oddly. Recommendation is to keep
   the existing rule for consistency and revisit only on user feedback.

## Implementation steps

1. `pdf-writer.service.ts` plus `pdf-writer.service.spec.ts`, built and tested standalone against a
   committed fixture image. No plugin wiring yet.
2. `renderPageDetailed()` in `page-renderer.service.ts`, `renderPage()` reduced to a wrapper.
3. `buildDocumentPath()` and `writeDocumentPdf()` in `markdown-writer.service.ts`.
4. `outputFormat` in `plugin-settings.intf.ts`, plus the `saveImages` migration on load.
5. Extract the shared render-and-write loop and wire it into `notebook-pipeline.service.ts` and
   `rmdoc-import.service.ts`.
6. Settings tab: output-format dropdown, revised image-format description, remove the
   `saveImages` toggle.
7. Documentation: `Architecture.md` (service table and data flow), `Domain Model.md` (settings),
   `Business Rules.md` (rules below), `README.md`, `docs/configuration.md`, `docs/usage.md`,
   `docs/release-notes.md`, and the day's history file.

## Business rules to record

- PDF export writes one PDF per notebook at `<targetFolder>/<folderPath>/<notebookName>.pdf`,
  independent of the per-page image folder.
- PDF page size is derived from the rendered image at 226 DPI, so scrolled pages produce taller PDF
  pages rather than cropped ones.
- WebP cannot be embedded in a PDF and is re-encoded to JPEG at the configured quality. Loose WebP
  files are unaffected.
- Generated PDFs carry no creation date or document info, so repeated syncs of an unchanged
  notebook produce identical bytes.
- Pages skipped as blank, and pages that failed to render, are absent from the PDF. PDF page
  numbers therefore do not necessarily match reMarkable page numbers.

## Testing

`pdf-writer.service.spec.ts` needs no `OffscreenCanvas`, since it takes encoded bytes as input:

- Fixed input produces byte-identical output across runs.
- Parse the emitted xref table back and confirm every offset lands on its object header.
- `/Count` matches the number of pages added, `Kids` length matches, trailer `/Size` matches the
  object count.
- MediaBox arithmetic: 1404x1872 px produces the expected point dimensions, and a grown canvas
  produces a taller box.
- Both filters round-trip: `DCTDecode` passes JPEG bytes through unmodified, `FlateDecode` output
  inflates back to the original RGB.
- Zero pages produces either a valid empty PDF or a clear failure, not a corrupt file.

Settings migration gets its own spec: `saveImages: false` with no `outputFormat` becomes `'none'`,
and an explicit `outputFormat` always wins.

## Manual verification needed

Not self-verifiable, no live vault and no GUI:

- Open a generated PDF in Obsidian's built-in PDF viewer, in Preview on macOS, and in one browser.
  Three readers, because a broken xref is often tolerated by one and rejected by another.
- Confirm page order matches the notebook, including a notebook that was reordered on the device.
- A notebook with scrolled content produces a taller page, not a cropped one.
- Each of the three `imageFormat` values with `outputFormat: 'pdf'`, checking the WebP fallback
  really produces a readable page.
- `'both'` writes the PDF and the loose images, and neither overwrites the other.
- Re-sync an unchanged notebook and confirm the PDF bytes are unchanged.

## Out of scope

Two adjacent pieces of work that the phrase "PDF support" also covers, deliberately excluded and
worth separate plans:

- **Syncing PDF-backed documents.** Detect `content.fileType === 'pdf'`, save the source PDF into
  the vault, and map annotation layers to their source pages (firmware 3.x `cPages` entries carry a
  page redirect for this, unverified against a real export). Without it, imported books and papers
  still sync as ink on blank pages.
- **Annotation burn-in.** Draw the strokes as vector paths over the original PDF pages to produce
  an annotated copy. It depends on the item above and would extend the same writer, since drawing
  paths into an existing PDF needs a content-stream appender rather than a new image XObject.

Both were offered and set aside in favour of the export format.

## Fixture gap

`src/app/services/import/__fixtures__/sample.rmdoc` is synthetic and contains no PDF-backed
document, so nothing in the repo exercises a real reMarkable export. That limitation already
applies to `.rmdoc` import (see `mobile-support.md`) and applies here too.
