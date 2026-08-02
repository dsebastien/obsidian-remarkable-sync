# Typed text extraction

Closes upstream issue #7. Status: **implemented and verified against a device notebook.**

Typed text, from the Type Folio keyboard or from handwriting converted on the device, is dropped
entirely. This extracts it into the generated note as **text**, not pixels.

## Why, in order of weight

**It is silent data loss, not just a search gap.** `pageHasContent` asks only whether a page has
non-eraser strokes:

```ts
return page.strokes.some((stroke) => !ERASER_PEN_TYPES.has(stroke.penType))
```

A typed page has no strokes, so it is filtered out before rendering. A wholly typed notebook reaches
`contentPages.length === 0`, reports "No pages with content found", writes nothing, and returns
success. Today that is indistinguishable from an empty notebook.

**Search, links and the graph.** Text in the note is indexed by Obsidian, and typed `[[wikilinks]]`
become real links.

**On-device handwriting conversion** arrives as text rather than being lost.

Explicitly **not** in scope: drawing typed text into the page images or the PDF. That needs font
files we cannot ship and, on the reference implementation's `experimental` branch, FreeType and
HarfBuzz, which are native libraries a bundled mobile-capable plugin cannot use. Rendering also
would not close #7, whose complaint is precisely that content is trapped in images.

## Wire format

From `RootTextBlock::read` and `readTextItem` in librm_lines, block type `0x07`:

```
tag 1  ID         blockId, must be CrdtId(0, 0)
tag 2  subblock   section one
  tag 1 subblock  (twice, nested)
    varuint       number of text items
    per item, subblock tag 0:
      tag 2 ID    itemId
      tag 3 ID    leftId
      tag 4 ID    rightId
      tag 5 Byte4 deletedLength
      tag 6 subblock, optional: string, or a uint32 format marker
  tag 2 then tag 1 subblock
    varuint       number of styles
    per style:    ID key, tag 1 ID timestamp, tag 2 subblock
                  byte 17, byte paragraph style, then optionally
                  tag 2 Byte1 baseStyle and tag 3 Byte4 styleProperties
  tag 3 subblock
    double posX, double posY
    tag 4 float   legacy width
    tag 5 subblock, optional: LWW float width
```

Paragraph styles: `BASIC 0, PlainText 1, Title 2, Sub 3, Bullet 4, BulletTab 5, CheckBox 6,
CheckBoxChecked 7, CheckBoxTab 8, CheckBoxTabChecked 9, Numbered 10, NumberedTab 11`.

## Ordering the CRDT

Items are not stored in reading order. Each carries `itemId`, `leftId`, `rightId` and a
`deletedLength`, and an item occupies a **range** of virtual positions starting at `itemId`: the
length of its string, or `deletedLength` when deleted, or 1 for a format marker.

Reading order comes from a topological sort:

- an item depends on whichever item's range contains its `leftId`
- an item depends on any item whose `rightId` falls inside its own range
- ties are broken by ascending `itemId`, which is what makes the result deterministic

Deleted runs are tombstones: they hold their positions so later items still resolve, but contribute
no characters.

## Plan

1. Domain types for text items, paragraph styles and a page's text.
2. A pure sequence resolver: items in, ordered plain text plus style spans out. Most of the risk
   lives here and it is testable without any binary.
3. `parseRootTextBlock` in the `.rm` parser.
4. `pageHasContent` counts text, so typed pages stop vanishing.
5. Emit into the generated note, mapping paragraph styles onto markdown.
6. Update `Business Rules.md`, which still records "CRDT text data in .rm files is not processed".

## Verified against a real notebook

A device notebook with a title, body, bullets, a numbered list, checkboxes, a sub-heading and some
handwriting. The synthetic fixtures alone would not have caught either defect below, because they
encoded the same assumptions as the parser.

**Subblock ends were four bytes short.** `reader.position + reader.readUint32()` evaluates its left
operand first, so every nested block ended before its length had been consumed. The real file failed
loudly on it, which is the good case: a seek far outside the file rather than plausible-looking
text.

**Paragraph styles were keyed one paragraph late.** A style is recorded against the id of the
**newline that begins** its paragraph, not the paragraph's first character, and the first paragraph
is keyed to the end marker `0:0`. In the fixture the bullets start at 1:62 and 1:78 while their
styles sit at 1:60 and 1:76.

Output checked line for line against the device's own thumbnail render of the same page: title, two
body lines, two bullets, a three-item numbered list, two unchecked checkboxes and a sub-heading, all
in the right order with the right styles. The typing errors in the source text are reproduced
exactly, including the deleted runs, which is the strongest evidence the sequence resolves
correctly.

Still untested: text edited from two devices at once (a genuine merge), and the checked state of a
checkbox, since none in the fixture were ticked.
