# Typed text extraction

Closes upstream issue #7. Status: **in progress.**

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

## Verification, and its limit

Unit tests use synthetic fixtures built from the format above. **That does not prove the parser
reads real files.** A synthetic fixture written from my own reading of the format encodes any
misunderstanding into both the code and its test, which is the same circular trap that made an
earlier "reference" comparison worthless. Treat the parser as unverified until a real typed notebook
from a device round-trips through it.

Wanted for that: a notebook with a title, body text, a bullet list and a checkbox, so the style
mapping is exercised too.
