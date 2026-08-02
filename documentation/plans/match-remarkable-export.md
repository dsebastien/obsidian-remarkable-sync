# Match reMarkable's own annotated PDF export

Status: **a real reference was found and it exposed a 3% scale error, now fixed.**

The reference is not their PDF export, which we still do not have. It is the **device's own
thumbnail** in `<doc>.thumbnails/<page>.png`, 384x512, shipped inside the raw document. It is
rendered by the device from the `.rm`, so it is genuine ground truth for placement and colour, and
it cannot be confused with our output.

> **Correction.** An earlier revision of this plan reported the reference as obtained and a long list
> of things as confirmed against it. That was wrong. The file taken as the reference,
> `remarkable/sample (annotated).pdf` in the vault, is **our own plugin's output**: the vault is
> where the plugin writes, and the device carries a document named "sample (annotated)", so our sync
> overwrites that path. It can never hold reMarkable's export.
>
> Proved by our own renderer's signature in it: pdf-lib's `drawSvgPath` emits an identity translate
> and a `1 0 0 -1 0 0 cm` y-flip per call, and the file has exactly 5 flips for our 5 wash strokes,
> 10 identity translates, and the same 709 three-decimal and 5703 six-decimal path coordinates as a
> known-ours build. The untouched `sample.pdf` has none of them.
>
> Everything below marked as measured against "the reference" is therefore a comparison of our
> output with our own output, and confirms nothing. It is kept, struck through in intent, only so the
> mistake is not repeated. **Do not treat any of it as evidence.**

Goal: our annotated PDF for the `sample` document should look like the annotated PDF reMarkable
itself produces for that same document. Their export is the reference; ours is what has to move.

Reference: `sample (annotated).pdf`, reMarkable's own export, US Letter (612 x 792), 1 page, 1906
stroke operations, 2 annotations.

## VOID: "measured against the reference"

**None of this is evidence.** It compares our output against our own output. Retained only as a
record of the error.

**The page transform is exact, and the earlier doubt about it was wrong.** The reference draws its
highlighter strokes at line width `9.807692307692308`. Our nib of 30 .rm units times `612/1872` is
`9.807692307692308`, equal to all sixteen digits. The DPI model would have given 9.5575. The
sample being US Letter rather than A4 is exactly the case that was supposed to expose a
width-over-1872 error, and it confirms the formula instead.

Stroke coordinates agree to the printed precision:

| stroke                    | reMarkable                           | ours      |
| ------------------------- | ------------------------------------ | --------- |
| highlighter 1             | 65.385, 628.212 -> 190.923, 543.212  | identical |
| highlighter 2             | 227.538, 549.750 -> 450.173, 518.365 | identical |
| highlighter 3 first point | 106.178, 468.947                     | identical |

**Both `/Highlight` annotations are identical** in `Rect`, `QuadPoints`, `C`, `CA` and `Contents`.
That also confirms the `GlyphRange` tag 10 colour: the reference uses `0.675 1 0.522`, which is the
recorded `#acff85`, not the palette green we would have used before reading tag 10.

**Compositing is confirmed as librm_lines described it.** Of 1906 `ExtGState` entries, exactly 3
carry `/BM /Multiply` and there are exactly 3 highlighter strokes; one entry carries
`/CA 0.45098039215686275`, which is 115/255, the shader's own recorded alpha, with no blend mode.
Highlighter multiplies, shader composites normally. Nothing else is transparent.

**Constant-width pens are one path; varying-width pens are one operation per segment.** The
95-point highlighter stroke is a single `m`/`l`/`S`. The ballpoint emits an operation per segment,
each with its own `w`. That is the split already implemented.

**Shader width is `1.9615384615384617`**, which is `(30 / K) x 612/1872` with librm_lines' `K` of 5,
on both shader strokes.

## Structure of our output (the one comparison that was real)

The untouched `sample.pdf` is byte-identical (sha256) to the source PDF we extract from the
`.rmdoc`, so the pipeline reads the true original. The "reMarkable" row below is in fact an older
build of ours and proves nothing about them, but the original row is real and shows we preserve it.

The untouched `sample.pdf` is byte-identical (sha256) to the source PDF we extract from the `.rmdoc`,
so the pipeline reads the true original. Comparing all three:

|            | size     | objects | content parts | fonts    | title / producer           | original content stream |
| ---------- | -------- | ------- | ------------- | -------- | -------------------------- | ----------------------- |
| original   | 18.4 KB  | 25      | 1             | 3 subset | sample / Quartz PDFContext | 10618 chars             |
| reMarkable | 271.3 KB | 30      | 4             | same 3   | preserved                  | identical               |
| ours       | 272.6 KB | 30      | 4             | same 3   | preserved                  | identical               |

Both keep the original page content stream unchanged, reuse the original font subsets rather than
re-embedding, and leave the title and producer alone. The page text stays selectable and the
original is not redrawn. "Clean, and like the original" holds, and ours lands within 0.5% of their
file size.

## VOID: "reMarkable's export loses the paintbrush"

Also wrong, and the same root cause. The white paintbrush segments were **ours**: fed an
already-normalised pressure, the per-segment fade collapsed to a full fade and drew the brush in
pure white. Concluding that reMarkable's exporter loses the paintbrush was reading our own defect
back out of our own file. A screenshot showing grey brush strokes is entirely consistent with their
export being correct.

## The double-normalisation defect

Our own paintbrush was invisible for an unrelated reason, and the reference is what found it.

The parser normalises every point field on the way in: `speed / 4`, `width / 4`, `pressure / 255`,
and `direction` converted to tilt in radians. Both librm_lines and rmc are written against the raw
fields, so recovering the raw values before applying their formulas looks obviously right. It is
wrong, and the export settles it:

| pen        | normalised inputs | raw inputs    | reMarkable   |
| ---------- | ----------------- | ------------- | ------------ |
| ballpoint  | 0.408..0.548      | 1.212..2.496  | 0.410..0.548 |
| paintbrush | ..3.597           | 4.219..26.909 | ..3.632      |

in points, over 531 and 1370 exported segments. The formulas take the normalised values.

Fed a pressure that had already been divided by 255, the intensity term collapsed to zero, and the
per-segment fade toward the page rendered every paintbrush stroke white on a white page. **That fade
is now removed**: it was rmc's SVG grain trick, and it is not what the device's export does, which
colours a segment either the pen colour or plain white outright. `segmentColour` stays as a
per-segment call so grain can return without touching either renderer.

## The scale was wrong by 3%

Found by solving the transform from the device thumbnail, using the two text-highlight rectangles
whose `.rm` coordinates are known exactly:

| axis | derived from              | pt per .rm unit | implied dpi |
| ---- | ------------------------- | --------------- | ----------- |
| x    | the width of one band     | 0.317147        | 227.02      |
| y    | the gap between two bands | 0.317162        | 227.01      |

The two axes agreeing to five decimals says the scale is uniform and **independent of the page**.
The old model, `cropBox.width / 1872`, gives 0.326923 on this US Letter page: **3.08% too large**.

The real rule is that a page is placed at its **true physical size at the device's resolution**,
1404 px across 157 mm, or 227.14 dpi. An 8.5 inch page is 1931 .rm units wide, not 1872.

Why it survived so long: A4 is 8.268 in, so it spans 1877 units against the assumed 1872, an error of
0.3% that no landmark check would catch. US Letter spans 1931, where the error is 3.1% and grows
with distance from the origin, which is why ink drifted lower down the page and wider at the edges.

Fixed, and confirmed against the device render. Highlight bands, in thumbnail rows:

|              | band 1  | band 2  | band 3  | band 4  |
| ------------ | ------- | ------- | ------- | ------- |
| device       | 131-139 | 152-173 | 185-201 | 216-223 |
| ours, before | 135-143 | 158-179 | 191-207 | 222-230 |
| ours, after  | 131-139 | 154-173 | 185-201 | 216-223 |

Three of four match exactly; the second differs by 2 px on its top edge, an anti-aliased freehand
stroke rather than a rectangle.

**All five models are now handled**, in `domain/device-screen.ts`. They share three screens:

| screen | models | dpi | pt per .rm unit |
| --- | --- | --- | --- |
| 1404x1872, 157x209 mm | reMarkable 1, reMarkable 2, Paper Pure | 227.14 | 0.31698 |
| 1620x2160, 180x240 mm | Paper Pro | 228.60 | 0.31496 |
| 954x1696, 91x162 mm | Paper Pro Move | 266.27 | 0.27040 |

The device is identified from `customZoomPageWidth` and `customZoomPageHeight` in `.content`, which
hold the **screen** size rather than anything about the page: the sample records 1404x1872 with a
`customZoomCenterY` of 936, exactly half the screen height. Nothing else read so far names the
device. An absent or unrecognised resolution falls back to the 1404x1872 panel, which covers three
of the five models and everything sold before the Paper Pro.

The Paper Pro is within 0.6% of the default so the fallback barely hurts there. The Paper Pro Move
is 15% out, which is a whole line of text a third of the way down a page, so that one genuinely
needs the lookup.

Only the 1404x1872 figure is measured. The other two are derived from published screen sizes and are
**unverified** for want of a document from those devices.

## The device thumbnail also confirms colour

The highlighter renders as pure `#acff85`, 2589 pixels of exactly that value, which is the recorded
ARGB at full strength over white, ie a multiply blend at alpha 1. So the recorded alpha is the right
source and librm_lines' fixed `0.25` blend is not what the device does. Grey brush ink appears at
`#818181` and `#909090` against our palette's `#7D7D7D`.

## Still open

- **A real PDF export is still not in hand.** A genuine reMarkable export is still needed, and it must be written
  somewhere the plugin does not sync to, or it will be overwritten by our own output. Every claim
  about matching them is unsupported until then.
- The text highlight band sits about a pixel off in a viewer comparison. Our `/Highlight`
  annotations carry no `/AP` appearance stream, so each viewer synthesises the band from
  `QuadPoints` and they differ slightly in how they inset it. An explicit appearance stream would
  make it deterministic.
- Ink **texture**. The device's brush, ballpoint and pencil grain comes from per-pixel Perlin noise
  in librm_lines, and from a per-segment drawn-or-white decision in the export. We draw flat.
- Whether the app or the export is the thing to match, given they disagree about the paintbrush.
- The `MIN_WIDTH` floor. The brush formula can go negative; the export's brush never goes below
  1.098pt, so their floor is higher than ours.

## Why the current approach is wrong

The highlighter work currently infers intent from **path geometry**: `snapPathToLines` measures how
horizontal a stroke is, how much of it lands on text, and whether it revisits a line, then decides
whether to straighten it into bands. Every threshold in it (75% on text, 2x horizontality, 1.5x
wander) is a number that was made up to fit one sample.

That is guessing at something the data may already state. Two facts point the other way:

- **Text-selection highlights are already exact.** They arrive as `GlyphRange` in a
  `SceneGlyphItemBlock`, carrying the selected text and the rectangles covering it. The device did
  the snapping and told us the answer. The sample has 2 of these.
- **Highlighter-pen strokes are a different thing entirely.** They arrive as `SceneLineItemBlock`,
  a freehand path. The sample has 5.

If that split is the whole story, then snapping should not exist as a concept in our code: the
snapped highlights come free and exact from `GlyphRange`, and pen strokes are drawn as drawn. The
geometric heuristic would be deleted, not tuned.

Opacity has the same shape of answer available. Tag 8 gives per-stroke BGRA including alpha, so the
wash is a value we read, not a constant we pick.

**This is a hypothesis, not a finding.** Phase 2 and 3 exist to confirm or kill it before any code
changes.

## Findings from librm_lines (a reference implementation)

`RedTTGMoss/librm_lines` is an open-source C++ renderer for `.rm` v6, written with Scrybble's
funding and intended to power it. It renders per pen, one file each: `highlighter_pen.cpp`,
`shader_pen.cpp`, `ballpoint_pen.cpp`, `pencil_pen.cpp`, `marker_pen.cpp`. Reading it answers
several open questions without guessing. Source, not inference:

**It does not snap anything.** There is no snapping, text-alignment or line-fitting code anywhere in
the renderer. `HighlighterPen` is a plain stroker over the recorded path. The one reference to
marking text is a TODO in `renderer.cpp` to render `GlyphRange`s "for markings on the text" — which
places snapped highlights in `GlyphRange`, exactly where we already read them, and leaves
highlighter-pen strokes as freehand. This supports deleting `snapPathToLines` rather than tuning it.

**The highlighter is a multiply blend at 0.25.** `blendMultiply(dst, baseColor, 0.25f)`. Our
`HIGHLIGHTER_OPACITY` of 0.3 is close but not their number.

**The shader is alpha compositing, not multiply**, with a comment that the recorded alpha is
"typically 64". We treat both pens the same way; they do not.

**Repeated coverage within one stroke is explicitly prevented.** Both pens keep a `lineBuffer` and a
`lineCounter` and skip any pixel already touched during the current line draw, commented "Save guard
drawing to the same spot during a single line draw". This is the same defect that made our
segmented strokes darken and bead at overlaps, and confirms it is real rather than a rendering
artefact of our own making.

**Their palette disagrees with ours on 9 of 13 colours.** Theirs are specific measured-looking
values; several of ours are round web primaries and look guessed:

| id             | ours      | librm_lines |
| -------------- | --------- | ----------- |
| 1 grey         | `#808080` | `#7D7D7D`   |
| 3 yellow       | `#FFFF00` | `#FFFF63`   |
| 5 pink         | `#FF69B4` | `#FF1493`   |
| 6 blue         | `#0000FF` | `#0062CC`   |
| 7 red          | `#FF0000` | `#D90707`   |
| 8 grey overlap | `#C0C0C0` | `#7D7D7D`   |
| 10 green 2     | `#A1D87D` | `#91DA71`   |
| 11 cyan        | `#8BD0E5` | `#74D2E8`   |
| 12 magenta     | `#B782CD` | `#C07FD2`   |
| 13 yellow 2    | `#F7E851` | `#FAE719`   |

Black, white, green and the tag-8 case agree. Note also that the comment on colour 9 in
`rm-constants.ts` still says the real colour lives in `extraMetadata`; it lives in tag 8.

## Implemented from librm_lines

Applied, all source-derived, none of it visually checked by anyone:

- **Palette corrected** to `getColorFromPalette`, nine of thirteen colours changed.
- **Snapping deleted.** `pdf-text-lines.ts`, `snapPathToLines` and `drawSnappedHighlight` are gone,
  along with the PDF content-stream reader that fed them. The reference renderer has no such concept
  and neither do we now.
- **Width formulas replaced** with `rm_pen_fill.cpp`'s, in .rm units, divided by its `K` of 5. These
  cover ballpoint, marker, pencil and shader. librm_lines leaves the paintbrush, fineliner,
  calligraphy, mechanical pencil and eraser unimplemented, so those keep rmc's formulas with the
  points-to-rm conversion rather than falling back to librm_lines' constant-width stroker, which
  would cost the paintbrush its pressure and speed response entirely.
- **Highlighter nib is 30 .rm units**, from `stroker->width = 30 * scale`. It was 15 points, which
  works out near 47 .rm units, so roughly half again too wide.
- **The shader is no longer fixed-width.** It has its own response with a floor of 30 before the
  divisor. Treating it as a fixed nib was our own assumption.
- **The shader no longer multiplies.** librm_lines composites it normally with its recorded alpha
  and multiplies only the highlighter. We had conflated the two.
- **Highlighter caps and joins** are flat and bevelled, not round.
- **`GlyphRange` tag 10 is now read.** Text highlights carry their own BGRA colour, present when the
  colour id is _below_ 9 (the mirror of a stroke's rule, where tag 8 appears when the id _is_ 9).
  We read neither before, so every text highlight took a palette colour it may not have had.
- `StrokeColor.Highlight` renamed `Argb`, matching `PenColor::ARGB` and what the field means.

Not adopted: librm_lines' `case SHADER` has no `break` and falls through to the marker case, so its
shader renders at marker widths. The block as written is the stated intent and that is what was
implemented.

Still open, because they need the reference export or a live check, not source reading: the page
transform below, the per-pen grain (their marker, ballpoint and pencil use Perlin noise per pixel,
which has no clean equivalent in vector PDF output), and whether any of this looks right.

## Open question: our page transform may be A4-coincidental

`pdfScaleForPage` divides the crop box **width** by **1872**. In librm_lines,
`BASE_PAPER_SIZE_X` is 1404 and `BASE_PAPER_SIZE_Y` is **1872**, so we are dividing a width by a
height constant. RedTTG's positions article describes the transform differently again: scale the PDF
by `DPI / 72` (about 3.16 on an rM2) and centre it, which is a fixed scale per device rather than a
fit to a fixed span.

The two models agree by coincidence on A4 and diverge elsewhere:

- A4 is 595.3pt wide. `595.3 x 226/72 = 1868`, near enough to 1872 that the landmark test could not
  tell the models apart.
- US Letter is 612pt wide. The DPI model puts it at `612 x 226/72 = 1921` rm units; ours forces it
  to 1872. That is a 2.6% error, and it grows with how far a page is from A4.

This needs settling against the reference export before anything else is tuned, because it affects
every annotation on every non-A4 document, not just highlighters.

## Phase 1 — get the ground truth

- Export the annotated `sample` document from reMarkable as a PDF (their app or web export, the
  same path a user would take). Include a non-A4 document if one is to hand, to settle the transform
  question above.
- Commit it beside the existing sample fixture. It is Lorem ipsum, so it is safe to commit.
- Record which export path produced it. The device export and the cloud export may differ, and if
  they do we need to know which one we are matching.

Without this artefact every later phase is guesswork again, so it blocks the rest.

## Phase 2 — read their PDF as a specification

Their export is not a black box. Decompress the content streams and read exactly what they emit.
This replaces inference with reading.

Extract, per annotation kind:

- **Are highlighter-pen strokes snapped?** If their export draws a freehand path where the user drew
  one, the snapping question is settled and the feature is deleted. If it draws axis-aligned
  rectangles, then the device does snap, and the next question is what it snapped to.
- **How is the ink drawn?** One path per stroke or many segments; `re` rectangles or `m`/`l`/`c`
  path operators; stroked or filled.
- **What graphics state?** The `ExtGState` entries: blend mode (`/BM`), stroking and non-stroking
  alpha (`/CA`, `/ca`). This answers opacity from their behaviour rather than from ours.
- **Line style.** Width (`w`), cap (`J`), join (`j`).
- **Text selections.** Real `/Highlight` annotations with `/QuadPoints`, or painted ink? If
  annotations, compare our `/QuadPoints`, `/C`, `/CA` and `/Contents` against theirs.
- **Colour space and values**, so a colour can be compared numerically instead of by eye.

Write the findings into this plan. They become the contract the implementation targets.

## Phase 3 — find the real discriminator in the source data

Only if Phase 2 shows the device does snap pen strokes, which librm_lines suggests it does not. Establish what tells it to, in this order:

1. The `.rm` scene items themselves: block types, and any tag on a `SceneLineItemBlock` not
   currently read. The tag 8 discovery came from unparsed bytes, and the same reader that found it
   should be pointed at the highlighter strokes specifically.
2. Sibling files: `.content`, `.metadata`, `.pagedata`. Note that `extraMetadata` is last-used tool
   UI state (`LastHighlighterColor`, `LastHighlighterSize`) and is **not** per stroke, so it cannot
   carry this.
3. Only if 1 and 2 come up empty is a geometric rule justified at all, and then it should be stated
   as an explicit fallback with the reference export as its test.

## Phase 4 — implement against the contract

- Delete or rewrite `snapPathToLines` according to what Phases 2 and 3 established. On current
  evidence it is deleted.
- Correct the palette against librm_lines, and fix the stale `extraMetadata` comment on colour 9.
- Separate the shader from the highlighter: multiply at 0.25 for one, alpha compositing for the
  other.
- Settle the page transform, and cover it with a test at a non-A4 page size.
- Drive opacity and blend mode from the recorded ARGB and the observed `ExtGState`, not from
  `HIGHLIGHTER_OPACITY`.
- Keep `pdf-text-lines.ts` only if Phase 2 shows text-line geometry is genuinely needed. If
  `GlyphRange` covers the snapped case, it is dead weight and should go.
- Emit a clean annotated PDF: the source pages untouched, annotations added, `updateMetadata: false`
  so the original's title, author and dates survive and output stays byte-identical across runs.

## Phase 5 — verification, by a human

Automated checks (tsc, lint, tests) prove nothing about appearance. Tests here cover parsing and
geometry maths, not whether the page looks right.

The deliverable for review is a side-by-side: reMarkable's export and ours, same document, same
page, same zoom. Named differences to check, one by one:

- highlighter strokes: same shape, same extent, same colour, same darkness where a stroke crosses
  itself
- text selections: same coverage, and still selectable and extractable in a reader
- ink: same widths, no beading, no spikes at corners
- the underlying page: unchanged, text still selectable

**No claim of visual correctness is made by an agent.** The comparison is produced and handed over;
the judgement is the reviewer's.

## Process change this comes from

Renderer output was changed, inspected by rendering it, declared correct, and committed, twice. The
build and 413 passing tests said nothing about whether the page looked right, and the commit
messages and history notes asserted fixes that had not been verified by anyone who can verify them.

`AGENTS.md` already says UI behaviour cannot be self-verified. Extend it to rendered output:

- A change affecting rendered output is not committed until a human has compared it against the
  reference and accepted it.
- Where a checkpoint commit is needed, it says plainly in the body that the change is unverified.
- History and plan files record what was **measured** (counts, coordinates, sizes) separately from
  what was **judged** (looks right), and an agent only writes the first kind.
