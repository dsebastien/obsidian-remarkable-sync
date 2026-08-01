# Pen fidelity

Status: **colour, opacity and width fixed. Per-segment texture still open.**

A side-by-side of the reMarkable web viewer against our output showed four defects. Three are now
fixed, and the cause turned out to be simpler than the original investigation assumed.

## The finding that changed everything

Strokes carry their own colour. rmscene reads seven tags and stops; newer firmware writes an
**eighth**, and rmscene warns "some data has not been read" rather than failing, which is easy to
miss.

```
tag 8, type Byte4, BGRA little-endian
  highlighter   85 ff ac ff  ->  #ACFF85 alpha 255
  shading marker 00 b2 fe 73  ->  #FEB200 alpha 115
```

So **colour ID 9 is not a colour**. It is a marker meaning "the real value is on the stroke",
written by tools whose colour is freely chosen. That is why a green highlighter and an orange
shading marker both arrived as "colour 9" and both rendered as the same guessed yellow.

Verified across **1,593 strokes and 8 tools**: tag 8 is present exactly when colour ID is 9, and
absent for every palette colour. No `.content` plumbing and no primary/secondary discriminator are
needed, both of which an earlier draft of this plan assumed.

The same field carries **alpha**, which is why the shading marker looked like a solid slab: 115/255
is about 45% and we drew it opaque.

## Fixed

| Defect | Fix |
| ------ | --- |
| Green highlighter rendered yellow | read tag 8, use it over the palette |
| Shading marker opaque | use tag 8 alpha |
| Pen 23 unmapped | `PenType.Shader = 23` |
| Highlighter ~10x too wide | fixed nib widths, not `width x multiplier` |

`domain/pen-model.ts` now holds this once and both the canvas renderer and the PDF annotator route
through it. They previously duplicated the pen logic, so every fix had to be made twice.

Palette colours **11 and 12** (cyan, magenta) do occur in real documents, which corrects a claim in
PR #14 that nothing exercised 10-13.

## Still open

**Per-segment texture.** `speed`, `direction` and `pressure` are parsed for every point and used by
nothing. They drive the brush intensity curve and the pencil width/opacity response, which is the
sketchy quality the device shows and we render flat. rmc has formulas for these; they are
approximations, not ground truth.

**Highlighter snapping.** The device aligns freehand highlighter strokes to the text lines beneath
them. Reproducing it needs the PDF text layer, so it is a separate piece of work.

**Widths beyond the fixed-nib pens.** The paintbrush measured 31-86.8 rm units (~10-28pt), which
still looks too heavy. Not yet calibrated.

## Where the firmware helped, and where it did not

Firmware 3.27.1.0 for Paper Pro was downloaded and unpacked (`codexctl`). Useful confirmations:

- PDF rendering is **PDFium** (`FPDFLink_GetAnnotRect`, `ANNOT_*` symbols in `xochitl_pdf_renderer`).
- `lineArgbCode` exists as a Qt property with setter and change signal, matching the per-stroke ARGB.
- Tool names confirmed, including `Shader` and `Highlighterv2`.

The decisive evidence came from the stroke bytes rather than the binary. Beta 3.28 is not reachable
through codexctl (`version-ids.json` does not carry it).

## Evidence

A Lorem ipsum `sample` document: 32 strokes across BallPointV2, HighlighterV2, PaintbrushV2 and
Shader, plus 2 text highlights. Non-personal, so usable as a committed fixture.
