import {
    compareCrdtId,
    crdtIdEquals,
    crdtIdKey,
    END_MARKER,
    ParagraphStyle
} from '../../domain/text'
import type { CrdtId, PageText, TextItem, TextStyle } from '../../domain/text'
import { log } from '../../../utils/log'

/**
 * A paragraph of resolved text, with the style the device gave it.
 */
export interface TextParagraph {
    readonly text: string
    readonly style: ParagraphStyle
}

/**
 * One resolved position of the sequence.
 *
 * `ch` is the character at that position, or null for a tombstone slot or a
 * format marker: those occupy positions so later anchors still resolve, but
 * contribute nothing to the output.
 */
export interface TextUnit {
    readonly id: CrdtId
    readonly ch: string | null
}

/**
 * How many virtual positions an item occupies.
 *
 * This is the crux of the whole sort. An item does not sit at a single
 * position: it claims a run starting at its `itemId`, so an item inserted
 * "after the third character of that run" points its `leftId` into the middle
 * of another item. A deleted run keeps its length precisely so those references
 * still resolve.
 *
 * Text length is counted in **code points**, not UTF-16 units: the device
 * assigns one position per character, so a run containing an astral-plane
 * character (an emoji, say) must not shift every position after it by one.
 */
function itemLength(item: TextItem): number {
    if (undefined !== item.formatMarker) return 1
    if (item.deletedLength > 0) return item.deletedLength
    return undefined === item.text ? 0 : [...item.text].length
}

/** A position, with the anchors ordering needs. */
interface AnchoredUnit extends TextUnit {
    /** Position this unit must follow; null for "no constraint". */
    readonly leftId: CrdtId | null
    /** Position this unit must precede; only the last unit of an item has one. */
    readonly rightId: CrdtId | null
}

/**
 * Expand items into one unit per position they claim.
 *
 * An earlier version ordered whole items instead, with "item A before item B"
 * edges. That cannot express an insertion into the middle of a run: the
 * inserter's `leftId` and `rightId` both point inside the same item, which at
 * item granularity reads as "A before B" and "B before A" at once — a false
 * cycle — and the page's entire text was dropped. Editing previously typed
 * text mid-sentence is exactly that shape, so it was not an exotic case.
 * Per-position units make the split representable: the run's characters up to
 * the anchor come first, then the insertion, then the rest.
 */
function expandItems(items: readonly TextItem[]): AnchoredUnit[] {
    const units: AnchoredUnit[] = []

    for (const item of items) {
        const length = itemLength(item)
        if (0 === length) continue

        const chars =
            undefined !== item.formatMarker || item.deletedLength > 0
                ? null
                : [...(item.text ?? '')]

        for (let i = 0; i < length; i++) {
            units.push({
                id: { author: item.itemId.author, counter: item.itemId.counter + i },
                ch: chars ? (chars[i] ?? null) : null,
                leftId:
                    0 === i
                        ? crdtIdEquals(item.leftId, END_MARKER)
                            ? null
                            : item.leftId
                        : { author: item.itemId.author, counter: item.itemId.counter + i - 1 },
                rightId:
                    i === length - 1 && !crdtIdEquals(item.rightId, END_MARKER)
                        ? item.rightId
                        : null
            })
        }
    }

    return units
}

/** Binary min-heap of unit indices, ordered by ascending CrdtId. */
class UnitHeap {
    private readonly heap: number[] = []

    constructor(private readonly units: readonly AnchoredUnit[]) {}

    get size(): number {
        return this.heap.length
    }

    push(index: number): void {
        const heap = this.heap
        heap.push(index)
        let i = heap.length - 1
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (this.less(heap[i]!, heap[parent]!)) {
                ;[heap[i], heap[parent]] = [heap[parent]!, heap[i]!]
                i = parent
            } else break
        }
    }

    pop(): number {
        const heap = this.heap
        const top = heap[0]!
        const last = heap.pop()!
        if (heap.length > 0) {
            heap[0] = last
            let i = 0
            for (;;) {
                const l = 2 * i + 1
                const r = 2 * i + 2
                let smallest = i
                if (l < heap.length && this.less(heap[l]!, heap[smallest]!)) smallest = l
                if (r < heap.length && this.less(heap[r]!, heap[smallest]!)) smallest = r
                if (smallest === i) break
                ;[heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!]
                i = smallest
            }
        }
        return top
    }

    private less(a: number, b: number): boolean {
        return compareCrdtId(this.units[a]!.id, this.units[b]!.id) < 0
    }
}

/**
 * Put the sequence's positions into reading order.
 *
 * Each unit must follow the position its `leftId` names and precede the one its
 * `rightId` names, and consecutive positions of one item follow each other.
 * Ties — concurrent insertions at the same anchor — are settled by ascending
 * id, which is what makes two devices agree.
 *
 * An anchor naming a position that does not exist adds no constraint: the unit
 * still sorts by id rather than taking the whole page down with it.
 *
 * Returns null on a cycle, which a well-formed file cannot produce (every
 * anchor points at an already-existing position) and means we have misread
 * something rather than that the file is broken.
 */
export function orderTextUnits(items: readonly TextItem[]): TextUnit[] | null {
    const units = expandItems(items)
    if (0 === units.length) return []

    const indexByKey = new Map<string, number>()
    units.forEach((unit, i) => indexByKey.set(crdtIdKey(unit.id), i))

    const dependants: number[][] = units.map(() => [])
    const inDegree: number[] = units.map(() => 0)
    const addEdge = (before: number, after: number): void => {
        dependants[before]!.push(after)
        inDegree[after]!++
    }

    units.forEach((unit, i) => {
        if (unit.leftId) {
            const left = indexByKey.get(crdtIdKey(unit.leftId))
            if (undefined !== left && left !== i) addEdge(left, i)
        }
        if (unit.rightId) {
            const right = indexByKey.get(crdtIdKey(unit.rightId))
            if (undefined !== right && right !== i) addEdge(i, right)
        }
    })

    const ready = new UnitHeap(units)
    units.forEach((_, i) => {
        if (0 === inDegree[i]) ready.push(i)
    })

    const ordered: TextUnit[] = []
    while (ready.size > 0) {
        const i = ready.pop()
        const unit = units[i]!
        ordered.push({ id: unit.id, ch: unit.ch })
        for (const dependant of dependants[i]!) {
            if (0 === --inDegree[dependant]!) ready.push(dependant)
        }
    }

    if (ordered.length !== units.length) {
        log('Cyclic dependency while ordering typed text', 'warn')
        return null
    }

    return ordered
}

/**
 * The plain text of a page, in reading order.
 *
 * Tombstones and format markers contribute no characters.
 */
export function textOf(items: readonly TextItem[]): string {
    const ordered = orderTextUnits(items)
    if (!ordered) return ''
    return ordered.map((unit) => unit.ch ?? '').join('')
}

/**
 * Split a page's text into paragraphs, each with the style the device gave it.
 *
 * A style is keyed to the id of the **newline that begins** the paragraph, not
 * to the paragraph's first character, and the first paragraph is keyed to the
 * end marker `0:0`. Verified against a device notebook: a bullet list whose
 * items start at 1:62 and 1:78 records its styles at 1:60 and 1:76, which are
 * the newlines that precede them. Keying on the first character instead put
 * every style one paragraph late.
 *
 * A paragraph with no recorded style is {@link ParagraphStyle.PlainText}, which
 * is what the device shows.
 */
export function paragraphsOf(page: PageText): TextParagraph[] {
    const ordered = orderTextUnits(page.items)
    if (!ordered) return []

    const styleAt = new Map<string, ParagraphStyle>()
    for (const style of page.styles) styleAt.set(crdtIdKey(style.startId), style.style)

    const paragraphs: TextParagraph[] = []
    let current = ''
    // The first paragraph is keyed to the end marker.
    let styleKey = crdtIdKey(END_MARKER)

    for (const { ch, id } of ordered) {
        if (null === ch) continue
        if ('\n' === ch) {
            paragraphs.push({
                text: current,
                style: styleAt.get(styleKey) ?? ParagraphStyle.PlainText
            })
            current = ''
            // This newline keys the paragraph that follows it.
            styleKey = crdtIdKey(id)
            continue
        }
        current += ch
    }
    if ('' !== current) {
        paragraphs.push({
            text: current,
            style: styleAt.get(styleKey) ?? ParagraphStyle.PlainText
        })
    }

    return paragraphs
}

/**
 * Render paragraphs as markdown.
 *
 * The device's own structure is kept where markdown has an equivalent, and
 * dropped where it does not: the indented list variants become nested list
 * items, and a numbered list is emitted as `1.` throughout, since the device
 * records the style rather than the number and markdown renumbers anyway.
 */
export function paragraphsToMarkdown(paragraphs: readonly TextParagraph[]): string {
    const lines: string[] = []

    for (const { text, style } of paragraphs) {
        if ('' === text.trim()) {
            lines.push('')
            continue
        }
        switch (style) {
            case ParagraphStyle.Title:
                lines.push(`## ${text}`)
                break
            case ParagraphStyle.Sub:
                lines.push(`### ${text}`)
                break
            case ParagraphStyle.Bullet:
                lines.push(`- ${text}`)
                break
            case ParagraphStyle.BulletTab:
                lines.push(`    - ${text}`)
                break
            case ParagraphStyle.CheckBox:
                lines.push(`- [ ] ${text}`)
                break
            case ParagraphStyle.CheckBoxChecked:
                lines.push(`- [x] ${text}`)
                break
            case ParagraphStyle.CheckBoxTab:
                lines.push(`    - [ ] ${text}`)
                break
            case ParagraphStyle.CheckBoxTabChecked:
                lines.push(`    - [x] ${text}`)
                break
            case ParagraphStyle.Numbered:
                lines.push(`1. ${text}`)
                break
            case ParagraphStyle.NumberedTab:
                lines.push(`    1. ${text}`)
                break
            case ParagraphStyle.Basic:
            case ParagraphStyle.PlainText:
            default:
                lines.push(text)
                break
        }
    }

    return lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** Convenience: a page's typed text as markdown. */
export function pageTextToMarkdown(page: PageText): string {
    return paragraphsToMarkdown(paragraphsOf(page))
}

/** Whether a page carries any typed characters. */
export function hasText(page: PageText | undefined): boolean {
    if (!page) return false
    return page.items.some((item) => 0 === item.deletedLength && (item.text?.length ?? 0) > 0)
}

export type { TextStyle }
