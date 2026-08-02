# Pen fidelity

Status: **colour, opacity and width fixed and pushed. Texture, snapping and blend mode written but
UNVERIFIED and uncommitted.**

The snapping approach described below is under challenge: it infers intent from path geometry when
the source data may state it outright. Read `match-remarkable-export.md` before building on any of
it.

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

| Defect                            | Fix                                        |
| --------------------------------- | ------------------------------------------ |
| Green highlighter rendered yellow | read tag 8, use it over the palette        |
| Shading marker opaque             | use tag 8 alpha                            |
| Pen 23 unmapped                   | `PenType.Shader = 23`                      |
| Highlighter ~10x too wide         | fixed nib widths, not `width x multiplier` |

`domain/pen-model.ts` now holds this once and both the canvas renderer and the PDF annotator route
through it. They previously duplicated the pen logic, so every fix had to be made twice.

Palette colours **11 and 12** (cyan, magenta) do occur in real documents, which corrects a claim in
PR #14 that nothing exercised 10-13.

## Also fixed

**Per-segment texture.** `speed`, `direction` and `pressure` were parsed for every point and used by
nothing. `segmentColour` now fades a brush or tilt-pencil segment toward the page by rmc's intensity
curve, so a fast light stroke is pale and a slow heavy one is solid. Colour is resolved per segment
in both renderers rather than once per stroke. rmc's curve is an approximation, not ground truth.

**Highlighter snapping.** `output/pdf-text-lines.ts` recovers the text bands of a page from its
content stream, and a stroke that is genuinely a line swipe is drawn as one rectangle per line it
crosses instead of following the hand's wobble. It deliberately does **not** decode glyphs: snapping needs
to know where the lines are, not what they say, and glyph decoding (encodings, CMaps, ToUnicode) is
where PDF text extraction gets hard. Tracking `BT`/`ET`/`Tf`/`TL`/`Td`/`TD`/`Tm`/`T*` and the show
operators needs no font tables.

**Only line swipes are snapped, and the path decides, not the tool.** Being near text is not intent:
on a page of prose almost every mark is near text. A circled word, a bracket in the margin, a fluid
shading sweep and a scribble are freehand marks, and straightening them into bands destroys what was
drawn. `snapPathToLines` accepts a stroke only when it behaves like a swipe, and returns null
otherwise so the raw path is drawn:

- mostly on text (at least 75% of path length lands on a line),
- horizontal (at least twice as much travel across as up and down),
- visits each line once, which rejects circles and back-and-forth scribbles,
- stays on each line it is on, within 1.5x that line's height.

On the sample, 1 of 5 wash strokes is accepted. The other 4 are a diagonal, a two-point stroke
spanning two lines, a wandering sweep and a 723-point shading path, all of which fall back to the
raw path. Whether that split is the _right_ one is unverified: every threshold here was chosen to
fit this one document.

Every page is measured on its own, and every line within it:

- Band height comes from each line's own font size, scaled by the text matrix. The sample page alone
  carries three heights (12, 18 and 36pt) and four different baseline gaps, so any page-wide constant
  would be wrong on that page, never mind across documents.
- The slack allowed when matching a stroke to a line is proportional to that line's height, not a
  fixed number of points. A fixed tolerance either misses a heading or bleeds across footnotes.
- A page whose text cannot be read, or that has no text at all, yields no bands and the raw stroke
  path is drawn instead. Snapping never loses ink.
- **Rotated pages are not snapped.** A content stream's lines are bands of constant y in user space,
  which only matches what the reader sees when `/Rotate` is 0. At 90 or 270 the visible lines run the
  other way and a band would cross the text rather than follow it.

**Wash pens composite multiply, once per stroke.** A v2 highlighter records ARGB alpha 255, so
drawing it as ordinary coverage painted an opaque bar over the very words it marked. Highlighter and
shader strokes and text-selection annotations now draw with `BlendMode.Multiply`.

That forced a second change. A multiply blend composites each drawing operation separately, so a
stroke drawn as one line per point pair multiplies itself at every overlap: the ink goes far darker
than its real colour and the round caps show as a string of beads. Unsnapped wash strokes are now
drawn as a **single** SVG path with round caps and joins, so the stroke composites once. This is
only safe because these pens have a fixed nib and one colour, so nothing varies along the stroke
that a single path would flatten. Textured pens keep the per-segment loop for exactly that reason.

## Still open

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
