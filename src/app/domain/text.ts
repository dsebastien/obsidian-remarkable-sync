/**
 * Text typed on a page with a keyboard.
 *
 * Handwriting is not this: it is stored as strokes and stays ink. The device's
 * own "Convert to text" is a share action rather than an edit, so it does not
 * write text back into the page.
 *
 * Stored as a CRDT so two devices editing the same note can merge, which means
 * the items are not held in reading order and have to be sorted. See
 * `services/parser/text-sequence.ts`.
 */

/**
 * A CRDT identifier: an author number and a per-author counter.
 *
 * `0:0` is the end marker, used for both ends of the sequence.
 */
export interface CrdtId {
    readonly author: number
    readonly counter: number
}

export const END_MARKER: CrdtId = { author: 0, counter: 0 }

export function crdtIdEquals(a: CrdtId, b: CrdtId): boolean {
    return a.author === b.author && a.counter === b.counter
}

/** Ascending order, used to break ties so the sort is deterministic. */
export function compareCrdtId(a: CrdtId, b: CrdtId): number {
    return a.author === b.author ? a.counter - b.counter : a.author - b.author
}

export function crdtIdKey(id: CrdtId): string {
    return `${id.author}:${id.counter}`
}

/**
 * One run of the text sequence.
 *
 * `text` is the characters it contributes. An item with `deletedLength` above
 * zero is a tombstone: it keeps its positions so later items still resolve
 * against them, but contributes nothing to the output. An item may instead
 * carry a `formatMarker`, which occupies exactly one position and marks where a
 * paragraph style applies.
 */
export interface TextItem {
    readonly itemId: CrdtId
    readonly leftId: CrdtId
    readonly rightId: CrdtId
    readonly deletedLength: number
    readonly text?: string
    readonly formatMarker?: number
}

/**
 * Paragraph styles, numbered as the device writes them.
 *
 * `Sub` is the smaller heading below `Title`. The `Tab` variants are the
 * indented forms of their list style.
 */
export enum ParagraphStyle {
    Basic = 0,
    PlainText = 1,
    Title = 2,
    Sub = 3,
    Bullet = 4,
    BulletTab = 5,
    CheckBox = 6,
    CheckBoxChecked = 7,
    CheckBoxTab = 8,
    CheckBoxTabChecked = 9,
    Numbered = 10,
    NumberedTab = 11
}

/**
 * A paragraph style, and the position it takes effect from.
 *
 * The device records the style against the id of the character the paragraph
 * begins at, so a style with no matching character is simply unused.
 */
export interface TextStyle {
    readonly startId: CrdtId
    readonly style: ParagraphStyle
}

/** All the typed text on one page. */
export interface PageText {
    readonly items: readonly TextItem[]
    readonly styles: readonly TextStyle[]
    /** Top-left of the text block, in .rm units */
    readonly x: number
    readonly y: number
    /** Column width in .rm units, 936 for the medium setting */
    readonly width: number
}
