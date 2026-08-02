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
 * How many virtual positions an item occupies.
 *
 * This is the crux of the whole sort. An item does not sit at a single
 * position: it claims a run starting at its `itemId`, so an item inserted
 * "after the third character of that run" points its `leftId` into the middle
 * of another item. A deleted run keeps its length precisely so those references
 * still resolve.
 */
function itemLength(item: TextItem): number {
    if (undefined !== item.formatMarker) return 1
    if (item.deletedLength > 0) return item.deletedLength
    return item.text?.length ?? 0
}

/** Whether `id` falls inside the run an item claims. */
function containsId(item: TextItem, id: CrdtId): boolean {
    const length = itemLength(item)
    if (0 === length || item.itemId.author !== id.author) return false
    return id.counter >= item.itemId.counter && id.counter < item.itemId.counter + length
}

/**
 * Put the items into reading order.
 *
 * Each item names the position it was inserted after (`leftId`) and before
 * (`rightId`), so the order is a dependency graph rather than a sort key: an
 * item must follow whichever item's run contains its `leftId`, and must follow
 * any item whose `rightId` points into its own run. Ties are settled by
 * ascending `itemId`, which is what makes two devices agree.
 *
 * Returns null on a cycle, which should not happen in a well-formed file and
 * means we have misread something rather than that the file is broken.
 */
export function sortTextItems(items: readonly TextItem[]): TextItem[] | null {
    const present = items.filter((item) => itemLength(item) > 0)
    if (0 === present.length) return []

    const byKey = new Map(present.map((item) => [crdtIdKey(item.itemId), item]))
    const deps = new Map<string, Set<string>>()

    for (const item of present) {
        const key = crdtIdKey(item.itemId)
        const set = deps.get(key) ?? new Set<string>()
        deps.set(key, set)

        if (!crdtIdEquals(item.leftId, END_MARKER)) {
            const left = present.find((other) => other !== item && containsId(other, item.leftId))
            if (left) set.add(crdtIdKey(left.itemId))
        }

        for (const other of present) {
            if (other === item) continue
            if (crdtIdEquals(other.rightId, END_MARKER)) continue
            if (containsId(item, other.rightId)) set.add(crdtIdKey(other.itemId))
        }
    }

    const ordered: TextItem[] = []
    while (deps.size > 0) {
        const ready: string[] = []
        for (const [key, set] of deps) {
            if (0 === set.size) ready.push(key)
        }

        if (0 === ready.length) {
            log('Cyclic dependency while ordering typed text', 'warn')
            return null
        }

        ready.sort((a, b) => compareCrdtId(byKey.get(a)!.itemId, byKey.get(b)!.itemId))
        for (const key of ready) {
            const item = byKey.get(key)
            if (item) ordered.push(item)
            deps.delete(key)
        }
        for (const set of deps.values()) {
            for (const key of ready) set.delete(key)
        }
    }

    return ordered
}

/**
 * The plain text of a page, in reading order.
 *
 * Tombstones and format markers contribute no characters.
 */
export function textOf(items: readonly TextItem[]): string {
    const ordered = sortTextItems(items)
    if (!ordered) return ''
    return ordered
        .map((item) =>
            item.deletedLength > 0 || undefined !== item.formatMarker ? '' : (item.text ?? '')
        )
        .join('')
}

/**
 * Split a page's text into paragraphs, each with the style the device gave it.
 *
 * A style is recorded against the id of the character its paragraph starts at,
 * so the styles are matched by walking the ordered characters and noting which
 * ids begin a paragraph. A paragraph with no recorded style is
 * {@link ParagraphStyle.PlainText}, which is what the device shows.
 */
export function paragraphsOf(page: PageText): TextParagraph[] {
    const ordered = sortTextItems(page.items)
    if (!ordered) return []

    const styleAt = new Map<string, ParagraphStyle>()
    for (const style of page.styles) styleAt.set(crdtIdKey(style.startId), style.style)

    /** Character, paired with the id of the position it occupies. */
    const chars: { ch: string; id: CrdtId }[] = []
    for (const item of ordered) {
        if (item.deletedLength > 0 || undefined !== item.formatMarker) continue
        const text = item.text ?? ''
        for (let i = 0; i < text.length; i++) {
            chars.push({
                ch: text[i]!,
                id: { author: item.itemId.author, counter: item.itemId.counter + i }
            })
        }
    }

    const paragraphs: TextParagraph[] = []
    let current = ''
    let style: ParagraphStyle | undefined

    const flush = (): void => {
        paragraphs.push({ text: current, style: style ?? ParagraphStyle.PlainText })
        current = ''
        style = undefined
    }

    for (const { ch, id } of chars) {
        if ('' === current && undefined === style) style = styleAt.get(crdtIdKey(id))
        if ('\n' === ch) {
            flush()
            continue
        }
        current += ch
    }
    if ('' !== current) flush()

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
