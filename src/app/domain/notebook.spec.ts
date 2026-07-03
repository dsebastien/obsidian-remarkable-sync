import { test, expect, describe } from 'bun:test'
import { normalizeFolder, notebooksInFolder, newestNotebook, favoriteNotebooks } from './notebook'
import type { NotebookSummary } from './notebook'

function nb(overrides: Partial<NotebookSummary>): NotebookSummary {
    return {
        id: 'id',
        visibleName: 'Notebook',
        parent: '',
        lastModified: '0',
        pageCount: 0,
        folderPath: '',
        pinned: false,
        ...overrides
    }
}

describe('normalizeFolder', () => {
    test('strips leading and trailing slashes', () => {
        expect(normalizeFolder('/2026')).toBe('2026')
        expect(normalizeFolder('/2026/')).toBe('2026')
        expect(normalizeFolder('2026/')).toBe('2026')
    })

    test('trims whitespace', () => {
        expect(normalizeFolder('  /2026/  ')).toBe('2026')
    })

    test('keeps nested paths', () => {
        expect(normalizeFolder('/Notes/2026/')).toBe('Notes/2026')
    })

    test('empty / root → empty string', () => {
        expect(normalizeFolder('')).toBe('')
        expect(normalizeFolder('/')).toBe('')
        expect(normalizeFolder('   ')).toBe('')
    })
})

describe('notebooksInFolder', () => {
    const books = nb({ id: 'b', visibleName: 'Book', folderPath: 'Books' })
    const root = nb({ id: 'r', visibleName: 'Root', folderPath: '' })
    const y2026 = nb({ id: 'y', visibleName: 'Journal', folderPath: '2026' })
    const y2026sub = nb({ id: 'ys', visibleName: 'Sub', folderPath: '2026/Sub' })
    const y2026x = nb({ id: 'yx', visibleName: 'Other', folderPath: '2026x' })
    const all = [books, root, y2026, y2026sub, y2026x]

    test('matches folder and its sub-folders (recursive)', () => {
        const result = notebooksInFolder(all, '/2026')
        expect(result.map((n) => n.id).sort()).toEqual(['y', 'ys'])
    })

    test('does not match a folder that merely shares a prefix', () => {
        const result = notebooksInFolder(all, '/2026')
        expect(result.map((n) => n.id)).not.toContain('yx')
    })

    test('empty folder returns all notebooks', () => {
        expect(notebooksInFolder(all, '').length).toBe(all.length)
        expect(notebooksInFolder(all, '/').length).toBe(all.length)
    })

    test('does not include other folders', () => {
        const result = notebooksInFolder(all, '/2026')
        expect(result.map((n) => n.id)).not.toContain('b')
        expect(result.map((n) => n.id)).not.toContain('r')
    })
})

describe('favoriteNotebooks', () => {
    test('keeps only pinned notebooks', () => {
        const starred = nb({ id: 's', pinned: true })
        const plain = nb({ id: 'p', pinned: false })
        expect(favoriteNotebooks([starred, plain]).map((n) => n.id)).toEqual(['s'])
    })

    test('ignores folders — a starred notebook matches anywhere', () => {
        const inBooks = nb({ id: 'b', folderPath: 'Books', pinned: true })
        const in2026 = nb({ id: 'y', folderPath: '2026', pinned: true })
        const unstarredIn2026 = nb({ id: 'u', folderPath: '2026', pinned: false })
        const result = favoriteNotebooks([inBooks, in2026, unstarredIn2026])
        expect(result.map((n) => n.id).sort()).toEqual(['b', 'y'])
    })

    test('empty when nothing is pinned', () => {
        expect(favoriteNotebooks([nb({ id: 'a' }), nb({ id: 'b' })])).toEqual([])
    })

    test('empty list → empty result', () => {
        expect(favoriteNotebooks([])).toEqual([])
    })
})

describe('newestNotebook', () => {
    test('returns undefined for empty list', () => {
        expect(newestNotebook([])).toBeUndefined()
    })

    test('picks the highest lastModified', () => {
        const a = nb({ id: 'a', lastModified: '1000' })
        const b = nb({ id: 'b', lastModified: '3000' })
        const c = nb({ id: 'c', lastModified: '2000' })
        expect(newestNotebook([a, b, c])?.id).toBe('b')
    })

    test('treats unparseable lastModified as 0', () => {
        const a = nb({ id: 'a', lastModified: 'nope' })
        const b = nb({ id: 'b', lastModified: '1' })
        expect(newestNotebook([a, b])?.id).toBe('b')
    })

    test('returns the single notebook when only one', () => {
        const a = nb({ id: 'a', lastModified: '5' })
        expect(newestNotebook([a])?.id).toBe('a')
    })
})
