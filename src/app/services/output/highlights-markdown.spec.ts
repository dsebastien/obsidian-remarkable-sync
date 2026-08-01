import { test, expect, describe } from 'bun:test'
import { buildHighlightsNote, hasHighlights, normaliseHighlightText } from './highlights-markdown'
import type { Highlight, Page } from '../../domain/notebook'
import { StrokeColor } from '../../domain/notebook'

const rect = (width: number) => ({ x: 0, y: 0, width, height: 34 })

const highlight = (text: string, widths: number[] = [100]): Highlight => ({
    text,
    color: 9 as StrokeColor,
    rects: widths.map(rect)
})

const page = (pageIndex: number, highlights: Highlight[], sourcePageIndex?: number): Page => ({
    pageId: `p${pageIndex}`,
    pageIndex,
    strokes: [],
    highlights,
    ...(undefined === sourcePageIndex ? {} : { sourcePageIndex })
})

describe('normaliseHighlightText', () => {
    test('collapses whitespace', () => {
        expect(normaliseHighlightText('  a   b \n c ')).toBe('a b c')
    })

    test('a single-line highlight is never altered', () => {
        expect(normaliseHighlightText('macOS/iOS and iPhone', [100])).toBe('macOS/iOS and iPhone')
    })

    /**
     * The real case from a device export: line breaks were stripped, so
     * A line break inside "DeviceTrust" arrived with the space stripped.
     */
    test('repairs a line join at a case transition', () => {
        const out = normaliseHighlightText('using tooling (Some DeviceTrust, OS-update', [90, 90])
        expect(out).toContain('Some Device Trust')
    })

    test('repairs a join after a full stop', () => {
        const out = normaliseHighlightText('first paragraph.Second paragraph here', [95, 95])
        expect(out).toContain('paragraph. Second')
    })

    /**
     * The regression that made the first attempt worse than doing nothing.
     * A blanket lowercase-to-uppercase rule shatters all of these.
     *
     * Short letter runs beside the split are the discriminator: "i|Phone" and
     * "macOS/i|OS" leave a one-letter run, which a real line join never does.
     *
     * Known residual risk, stated rather than hidden: "Bit|Locker" is
     * shape-identical to a genuine join like "Device|Trust", so no rule
     * distinguishes them without a dictionary. It only splits if a line-end
     * estimate happens to land on it.
     */
    test('never splits camelCase with a short leading run', () => {
        const out = normaliseHighlightText(
            'Deployment targets (macOS/iOS) were checked by the team today',
            [180, 180]
        )
        expect(out).toContain('macOS/iOS')
    })

    test('never splits iPhone', () => {
        const out = normaliseHighlightText(
            'options and defaults with 120+ iPhone settings applied here',
            [170, 170]
        )
        expect(out).toContain('iPhone')
    })

    test('leaves an ambiguous lowercase join alone rather than guessing wrong', () => {
        // "Backupservers" could equally be "Backups ervers" without a
        // dictionary, so it is left intact.
        const out = normaliseHighlightText('and Backupservers in scope', [70, 70])
        expect(out).toContain('Backupservers')
        expect(out).not.toContain('Backups ervers')
    })

    test('inserts at most one space per line join', () => {
        const text = 'aaaaBbbb cccc Dddd eeee Ffff gggg Hhhh'
        const before = (text.match(/ /g) ?? []).length
        const after = (normaliseHighlightText(text, [50, 50]).match(/ /g) ?? []).length
        expect(after - before).toBeLessThanOrEqual(1)
    })

    test('no rectangles means no repair attempted', () => {
        expect(normaliseHighlightText('DeviceTrust', [])).toBe('DeviceTrust')
    })

    test('zero-width rectangles are ignored safely', () => {
        expect(normaliseHighlightText('DeviceTrust', [0, 0])).toBe('DeviceTrust')
    })
})

describe('hasHighlights', () => {
    test('true only when a page carries highlights', () => {
        expect(hasHighlights([page(0, [highlight('x')])])).toBe(true)
        expect(hasHighlights([page(0, [])])).toBe(false)
        expect(hasHighlights([])).toBe(false)
    })
})

describe('buildHighlightsNote', () => {
    test('lists highlights as quotes under their source page', () => {
        const note = buildHighlightsNote({
            documentName: 'Some paper',
            pages: [page(0, [highlight('First point'), highlight('Second point')], 0)]
        })

        expect(note).toContain('# Some paper — highlights')
        expect(note).toContain('2 highlights.')
        expect(note).toContain('## Page 1')
        expect(note).toContain('> First point')
        expect(note).toContain('> Second point')
    })

    test('page numbers are one-based, matching the reader', () => {
        const note = buildHighlightsNote({
            documentName: 'Doc',
            pages: [page(0, [highlight('x')], 4)]
        })
        expect(note).toContain('## Page 5')
    })

    test('a device-inserted page is labelled rather than numbered', () => {
        const note = buildHighlightsNote({
            documentName: 'Doc',
            pages: [page(0, [highlight('x')])]
        })
        expect(note).toContain('## Inserted page')
    })

    test('links the annotated PDF when one was written', () => {
        const note = buildHighlightsNote({
            documentName: 'Doc',
            pages: [page(0, [highlight('x')], 0)],
            annotatedPath: 'Doc (annotated).pdf'
        })
        expect(note).toContain('[[Doc (annotated).pdf]]')
    })

    test('omits the link when no annotated copy exists', () => {
        const note = buildHighlightsNote({
            documentName: 'Doc',
            pages: [page(0, [highlight('x')], 0)]
        })
        expect(note).not.toContain('[[')
    })

    test('singular wording for one highlight', () => {
        const note = buildHighlightsNote({
            documentName: 'Doc',
            pages: [page(0, [highlight('x')], 0)]
        })
        expect(note).toContain('1 highlight.')
    })

    /**
     * The note must not churn: no timestamp, no counter, nothing that varies
     * between runs, so the skip-if-unchanged guard can leave the file alone.
     */
    test('is byte-identical across runs', () => {
        const build = (): string =>
            buildHighlightsNote({ documentName: 'Doc', pages: [page(0, [highlight('x')], 0)] })
        expect(build()).toBe(build())
        expect(build()).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    })

    test('ends with exactly one newline', () => {
        const note = buildHighlightsNote({
            documentName: 'Doc',
            pages: [page(0, [highlight('x')], 0)]
        })
        expect(note.endsWith('\n')).toBe(true)
        expect(note.endsWith('\n\n')).toBe(false)
    })
})
