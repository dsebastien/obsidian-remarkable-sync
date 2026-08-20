import { test, expect, describe } from 'bun:test'
import {
    orderTextUnits,
    textOf,
    paragraphsOf,
    paragraphsToMarkdown,
    pageTextToMarkdown,
    hasText
} from './text-sequence'
import { ParagraphStyle, END_MARKER } from '../../domain/text'
import type { CrdtId, PageText, TextItem } from '../../domain/text'

const id = (author: number, counter: number): CrdtId => ({ author, counter })

const item = (
    itemId: CrdtId,
    leftId: CrdtId,
    rightId: CrdtId,
    text: string,
    deletedLength = 0
): TextItem => ({ itemId, leftId, rightId, deletedLength, text })

const page = (items: TextItem[], styles: PageText['styles'] = []): PageText => ({
    items,
    styles,
    x: 0,
    y: 0,
    width: 936
})

describe('orderTextUnits', () => {
    /**
     * The compacted form the device writes: one item holding a whole
     * paragraph, both ends pointing at the end marker.
     */
    test('a single compacted item is its own order', () => {
        const only = item(id(1, 16), END_MARKER, END_MARKER, 'Test\n')
        expect(textOf([only])).toBe('Test\n')
        expect(
            orderTextUnits([only])!
                .map((u) => u.ch)
                .join('')
        ).toBe('Test\n')
    })

    /**
     * The expanded form, one item per character. Note the ids run 1:16..1:20
     * and each points at its neighbours, so reading order is recoverable even
     * though the array is shuffled.
     */
    test('per-character items sort back into reading order', () => {
        const chars = [...'Test\n'].map((ch, i) =>
            item(
                id(1, 16 + i),
                0 === i ? END_MARKER : id(1, 15 + i),
                i === 4 ? END_MARKER : id(1, 17 + i),
                ch
            )
        )
        const shuffled = [chars[3]!, chars[0]!, chars[4]!, chars[2]!, chars[1]!]
        expect(textOf(shuffled)).toBe('Test\n')
    })

    /**
     * The reason an item claims a *range* rather than a point. "XY" occupies
     * 1:10 and 1:11, so an insertion after its second character points its
     * leftId at 1:11, which is inside the run rather than at its start.
     */
    test('an insertion after the end of a run resolves against that run', () => {
        const run = item(id(1, 10), END_MARKER, END_MARKER, 'XY')
        const after = item(id(1, 20), id(1, 11), END_MARKER, 'Z')
        expect(textOf([after, run])).toBe('XYZ')
    })

    /**
     * The everyday edit: type a sentence, then click into the middle of it and
     * add a word. The new item's leftId AND rightId both point inside the run,
     * which requires splitting it. The previous whole-item ordering read this
     * as a cycle and dropped the page's entire text.
     */
    test('an insertion into the middle of a run splits it', () => {
        const run = item(id(1, 10), END_MARKER, END_MARKER, 'Hello world')
        // After the 'o' of "Hello" (1:14), before the space (1:15)
        const insert = item(id(1, 30), id(1, 14), id(1, 15), ' dear')
        expect(textOf([run, insert])).toBe('Hello dear world')
    })

    test('an insertion anchored inside a tombstone still lands in place', () => {
        const kept = item(id(1, 10), END_MARKER, END_MARKER, 'AB')
        const gone: TextItem = {
            itemId: id(1, 12),
            leftId: id(1, 11),
            rightId: END_MARKER,
            deletedLength: 4,
            text: ''
        }
        // Anchored at the middle of the deleted run
        const insert = item(id(1, 40), id(1, 13), id(1, 14), 'C')
        expect(textOf([gone, insert, kept])).toBe('ABC')
    })

    /**
     * Positions are counted in code points, not UTF-16 units: an emoji is one
     * position on the device, so an anchor after it must not land one short.
     */
    test('astral-plane characters occupy one position each', () => {
        const run = item(id(1, 10), END_MARKER, END_MARKER, 'a\u{1F600}b')
        // 'a' is 1:10, the emoji is 1:11, 'b' is 1:12
        const insert = item(id(1, 30), id(1, 11), id(1, 12), 'X')
        expect(textOf([run, insert])).toBe('a\u{1F600}Xb')
    })

    test('ties are broken by ascending item id, so the order is deterministic', () => {
        const a = item(id(1, 30), END_MARKER, END_MARKER, 'a')
        const b = item(id(1, 10), END_MARKER, END_MARKER, 'b')
        const c = item(id(2, 5), END_MARKER, END_MARKER, 'c')
        expect(textOf([a, b, c])).toBe(textOf([c, a, b]))
        // author 1 before author 2, and within author 1, counter 10 before 30
        expect(textOf([a, b, c])).toBe('bac')
    })

    test('an anchor naming a missing position adds no constraint', () => {
        const a = item(id(1, 10), id(9, 99), END_MARKER, 'a')
        const b = item(id(1, 20), id(1, 10), END_MARKER, 'b')
        expect(textOf([b, a])).toBe('ab')
    })

    test('an empty sequence yields no items and no text', () => {
        expect(orderTextUnits([])).toEqual([])
        expect(textOf([])).toBe('')
    })

    test('a cycle is reported rather than looping forever', () => {
        const a: TextItem = {
            itemId: id(1, 1),
            leftId: id(1, 2),
            rightId: END_MARKER,
            deletedLength: 0,
            text: 'a'
        }
        const b: TextItem = {
            itemId: id(1, 2),
            leftId: id(1, 1),
            rightId: END_MARKER,
            deletedLength: 0,
            text: 'b'
        }
        expect(orderTextUnits([a, b])).toBeNull()
        expect(textOf([a, b])).toBe('')
    })
})

describe('deleted runs', () => {
    /**
     * A tombstone holds its positions so later items still resolve against
     * them, but contributes no characters. Dropping it outright would break
     * every reference that points into it.
     */
    test('a deleted run contributes nothing but keeps its positions', () => {
        const kept = item(id(1, 10), END_MARKER, END_MARKER, 'Hi')
        const gone: TextItem = {
            itemId: id(1, 12),
            leftId: id(1, 11),
            rightId: END_MARKER,
            deletedLength: 5,
            text: ''
        }
        const after = item(id(1, 30), id(1, 16), END_MARKER, '!')
        expect(textOf([after, gone, kept])).toBe('Hi!')
    })

    test('a page of only deleted text reads as empty', () => {
        const gone: TextItem = {
            itemId: id(1, 10),
            leftId: END_MARKER,
            rightId: END_MARKER,
            deletedLength: 3,
            text: ''
        }
        expect(textOf([gone])).toBe('')
        expect(hasText(page([gone]))).toBe(false)
    })
})

describe('paragraphsOf', () => {
    test('newlines split paragraphs and are not kept in the text', () => {
        const p = page([item(id(1, 16), END_MARKER, END_MARKER, 'one\ntwo\n')])
        expect(paragraphsOf(p).map((x) => x.text)).toEqual(['one', 'two'])
    })

    /**
     * A style is keyed to the **newline that begins** its paragraph, not to the
     * paragraph's first character, and the first paragraph is keyed to the end
     * marker.
     *
     * Verified against a device notebook: its bullets start at 1:62 and 1:78
     * and their styles are recorded at 1:60 and 1:76, the newlines in front of
     * them. Keying on the first character put every style one paragraph late,
     * which the synthetic fixtures alone did not catch because they encoded the
     * same wrong assumption as the parser.
     *
     * Here 'one\ntwo\n' starts at 1:16, so the newline after 'one' is 1:19 and
     * keys the paragraph 'two'.
     */
    test('a style is keyed to the newline that starts its paragraph', () => {
        const p = page(
            [item(id(1, 16), END_MARKER, END_MARKER, 'one\ntwo\n')],
            [
                { startId: END_MARKER, style: ParagraphStyle.Title },
                { startId: id(1, 19), style: ParagraphStyle.Bullet }
            ]
        )
        const out = paragraphsOf(p)
        expect(out[0]).toEqual({ text: 'one', style: ParagraphStyle.Title })
        expect(out[1]).toEqual({ text: 'two', style: ParagraphStyle.Bullet })
    })

    test('the first paragraph takes the style keyed to the end marker', () => {
        const p = page(
            [item(id(1, 16), END_MARKER, END_MARKER, 'heading\nbody\n')],
            [{ startId: END_MARKER, style: ParagraphStyle.Title }]
        )
        const out = paragraphsOf(p)
        expect(out[0]!.style).toBe(ParagraphStyle.Title)
        expect(out[1]!.style).toBe(ParagraphStyle.PlainText)
    })

    test('a style keyed to a position that no longer exists is ignored', () => {
        const p = page(
            [item(id(1, 16), END_MARKER, END_MARKER, 'kept\n')],
            [{ startId: id(9, 99), style: ParagraphStyle.Title }]
        )
        expect(paragraphsOf(p)[0]!.style).toBe(ParagraphStyle.PlainText)
    })

    test('text with no trailing newline still yields its last paragraph', () => {
        const p = page([item(id(1, 16), END_MARKER, END_MARKER, 'no trailing newline')])
        expect(paragraphsOf(p).map((x) => x.text)).toEqual(['no trailing newline'])
    })
})

describe('paragraphsToMarkdown', () => {
    test('each device style maps to its markdown equivalent', () => {
        const md = paragraphsToMarkdown([
            { text: 'Heading', style: ParagraphStyle.Title },
            { text: 'Sub', style: ParagraphStyle.Sub },
            { text: 'Body', style: ParagraphStyle.PlainText },
            { text: 'first', style: ParagraphStyle.Bullet },
            { text: 'nested', style: ParagraphStyle.BulletTab },
            { text: 'todo', style: ParagraphStyle.CheckBox },
            { text: 'done', style: ParagraphStyle.CheckBoxChecked },
            { text: 'step', style: ParagraphStyle.Numbered }
        ])
        expect(md).toBe(
            [
                '## Heading',
                '### Sub',
                'Body',
                '- first',
                '    - nested',
                '- [ ] todo',
                '- [x] done',
                '1. step'
            ].join('\n')
        )
    })

    /**
     * Headings become h2 rather than h1: the note already has the notebook
     * name as its title, and a second h1 competes with it in Obsidian's
     * outline.
     */
    test('a title becomes h2, leaving h1 to the note itself', () => {
        expect(paragraphsToMarkdown([{ text: 'T', style: ParagraphStyle.Title }])).toBe('## T')
    })

    test('runs of blank paragraphs collapse rather than stacking up', () => {
        const md = paragraphsToMarkdown([
            { text: 'a', style: ParagraphStyle.PlainText },
            { text: '', style: ParagraphStyle.PlainText },
            { text: '', style: ParagraphStyle.PlainText },
            { text: '', style: ParagraphStyle.PlainText },
            { text: 'b', style: ParagraphStyle.PlainText }
        ])
        expect(md).toBe('a\n\nb')
    })

    test('an unknown style degrades to plain text rather than throwing', () => {
        expect(paragraphsToMarkdown([{ text: 'x', style: 99 as ParagraphStyle }])).toBe('x')
    })

    test('no paragraphs yields an empty string', () => {
        expect(paragraphsToMarkdown([])).toBe('')
    })
})

describe('pageTextToMarkdown', () => {
    test('resolves, splits and renders in one step', () => {
        const p = page(
            [item(id(1, 16), END_MARKER, END_MARKER, 'Notes\nfirst\n')],
            [
                { startId: END_MARKER, style: ParagraphStyle.Title },
                // the newline after 'Notes', which begins the next paragraph
                { startId: id(1, 21), style: ParagraphStyle.Bullet }
            ]
        )
        expect(pageTextToMarkdown(p)).toBe('## Notes\n- first')
    })
})

describe('hasText', () => {
    test('true only when there are live characters', () => {
        expect(hasText(undefined)).toBe(false)
        expect(hasText(page([]))).toBe(false)
        expect(hasText(page([item(id(1, 16), END_MARKER, END_MARKER, '')]))).toBe(false)
        expect(hasText(page([item(id(1, 16), END_MARKER, END_MARKER, 'x')]))).toBe(true)
    })
})
