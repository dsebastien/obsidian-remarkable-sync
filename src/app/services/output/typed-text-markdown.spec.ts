import { test, expect, describe } from 'bun:test'
import { buildTypedTextNote, hasTypedText } from './typed-text-markdown'
import { ParagraphStyle, END_MARKER } from '../../domain/text'
import type { PageText } from '../../domain/text'
import type { Page } from '../../domain/notebook'

const text = (value: string, styles: PageText['styles'] = []): PageText => ({
    items: [
        {
            itemId: { author: 1, counter: 16 },
            leftId: END_MARKER,
            rightId: END_MARKER,
            deletedLength: 0,
            text: value
        }
    ],
    styles,
    x: 0,
    y: 0,
    width: 936
})

const page = (pageIndex: number, value?: string, styles?: PageText['styles']): Page => ({
    pageId: `p${pageIndex}`,
    pageIndex,
    strokes: [],
    ...(undefined === value ? {} : { text: text(value, styles ?? []) })
})

describe('hasTypedText', () => {
    test('false when no page carries text', () => {
        expect(hasTypedText([page(0)])).toBe(false)
        expect(hasTypedText([])).toBe(false)
    })

    test('true when a page carries typed characters', () => {
        expect(hasTypedText([page(0), page(1, 'hello')])).toBe(true)
    })

    test('a page whose text is only whitespace does not count', () => {
        expect(hasTypedText([page(0, '\n\n')])).toBe(false)
    })
})

describe('buildTypedTextNote', () => {
    /**
     * A single page reads as a plain document. Page headings would turn every
     * typed note into a report about itself.
     */
    test('one page of text gets no page heading', () => {
        const note = buildTypedTextNote({
            documentName: 'Meeting',
            pages: [page(0, 'Some notes\n')]
        })
        expect(note).toBe('# Meeting\n\nSome notes\n')
    })

    test('several pages are separated by page headings', () => {
        const note = buildTypedTextNote({
            documentName: 'Journal',
            pages: [page(0, 'first\n'), page(1, 'second\n')]
        })
        expect(note).toContain('## Page 1')
        expect(note).toContain('## Page 2')
        expect(note.indexOf('first')).toBeLessThan(note.indexOf('## Page 2'))
    })

    test('pages without text are skipped, and numbering follows the page index', () => {
        const note = buildTypedTextNote({
            documentName: 'Mixed',
            pages: [page(0), page(1, 'typed\n'), page(2), page(3, 'also typed\n')]
        })
        expect(note).toContain('## Page 2')
        expect(note).toContain('## Page 4')
        expect(note).not.toContain('## Page 1')
    })

    /**
     * Styles are keyed to the newline in front of their paragraph, and the
     * first paragraph to the end marker. 'Agenda\nfirst item\n' starts at 1:16,
     * so its newline sits at 1:22.
     */
    test('device paragraph styles survive into the note', () => {
        const note = buildTypedTextNote({
            documentName: 'Structured',
            pages: [
                page(0, 'Agenda\nfirst item\n', [
                    { startId: END_MARKER, style: ParagraphStyle.Title },
                    { startId: { author: 1, counter: 22 }, style: ParagraphStyle.Bullet }
                ])
            ]
        })
        expect(note).toContain('## Agenda')
        expect(note).toContain('- first item')
    })

    /**
     * The write guard skips a file whose bytes have not changed, so the note
     * must not carry a date or a counter.
     */
    test('the same document always produces the same bytes', () => {
        const build = (): string =>
            buildTypedTextNote({ documentName: 'Stable', pages: [page(0, 'unchanged\n')] })
        expect(build()).toBe(build())
    })

    test('the note ends with exactly one newline', () => {
        const note = buildTypedTextNote({ documentName: 'N', pages: [page(0, 'x\n')] })
        expect(note.endsWith('x\n')).toBe(true)
        expect(note.endsWith('\n\n')).toBe(false)
    })
})
