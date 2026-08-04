import { test, expect, describe } from 'bun:test'
import { DEFAULT_SORT_VALUE, SORT_MODES, parseSortValue, sortNotebooks } from './notebook-sort'
import type { NotebookSummary } from './notebook'

const nb = (visibleName: string, lastModified: string, folderPath = ''): NotebookSummary => ({
    id: `${visibleName}-${lastModified}`,
    visibleName,
    parent: '',
    lastModified,
    pageCount: 0,
    folderPath
})

const names = (list: readonly NotebookSummary[]): string[] => list.map((n) => n.visibleName)

describe('parseSortValue', () => {
    test('resolves each offered value', () => {
        for (const mode of SORT_MODES) {
            expect(parseSortValue(mode.value)).toEqual(mode.mode)
        }
    })

    test('an unknown or missing value falls back to the default', () => {
        expect(parseSortValue(undefined)).toEqual(SORT_MODES[0]!.mode)
        expect(parseSortValue('nonsense')).toEqual(SORT_MODES[0]!.mode)
        expect(parseSortValue('')).toEqual(SORT_MODES[0]!.mode)
    })

    test('the default value is one of the offered modes', () => {
        expect(SORT_MODES.some((m) => m.value === DEFAULT_SORT_VALUE)).toBe(true)
    })
})

describe('sortNotebooks by modified date', () => {
    const list = [nb('middle', '2000'), nb('newest', '3000'), nb('oldest', '1000')]

    test('newest first', () => {
        expect(names(sortNotebooks(list, { field: 'modified', direction: 'desc' }))).toEqual([
            'newest',
            'middle',
            'oldest'
        ])
    })

    test('oldest first', () => {
        expect(names(sortNotebooks(list, { field: 'modified', direction: 'asc' }))).toEqual([
            'oldest',
            'middle',
            'newest'
        ])
    })

    test('equal timestamps fall back to name, so the order is stable', () => {
        const tied = [nb('charlie', '500'), nb('alpha', '500'), nb('bravo', '500')]
        const once = names(sortNotebooks(tied, { field: 'modified', direction: 'desc' }))
        const twice = names(sortNotebooks(tied, { field: 'modified', direction: 'desc' }))

        expect(once).toEqual(['alpha', 'bravo', 'charlie'])
        expect(once).toEqual(twice)
    })

    test('an unparseable timestamp sorts as oldest instead of corrupting the order', () => {
        const messy = [nb('good', '2000'), nb('broken', 'not-a-number'), nb('older', '1000')]
        expect(names(sortNotebooks(messy, { field: 'modified', direction: 'desc' }))).toEqual([
            'good',
            'older',
            'broken'
        ])
    })
})

describe('sortNotebooks by name', () => {
    test('A to Z, case-insensitively', () => {
        const list = [nb('zebra', '1'), nb('Apple', '1'), nb('mango', '1')]
        expect(names(sortNotebooks(list, { field: 'name', direction: 'asc' }))).toEqual([
            'Apple',
            'mango',
            'zebra'
        ])
    })

    test('Z to A', () => {
        const list = [nb('Apple', '1'), nb('zebra', '1'), nb('mango', '1')]
        expect(names(sortNotebooks(list, { field: 'name', direction: 'desc' }))).toEqual([
            'zebra',
            'mango',
            'Apple'
        ])
    })

    /**
     * The real reason for numeric collation: a plain string sort puts
     * "Notebook 10" before "Notebook 2", which reads as broken.
     */
    test('digit runs compare numerically', () => {
        const list = [nb('Notebook 10', '1'), nb('Notebook 2', '1'), nb('Notebook 1', '1')]
        expect(names(sortNotebooks(list, { field: 'name', direction: 'asc' }))).toEqual([
            'Notebook 1',
            'Notebook 2',
            'Notebook 10'
        ])
    })

    test('dated names sort chronologically by name', () => {
        const list = [nb('2026-01-24', '9'), nb('2026-07-22', '1'), nb('2026-02-01', '5')]
        expect(names(sortNotebooks(list, { field: 'name', direction: 'asc' }))).toEqual([
            '2026-01-24',
            '2026-02-01',
            '2026-07-22'
        ])
    })
})

describe('sortNotebooks contract', () => {
    test('does not mutate the input', () => {
        const list = [nb('b', '1'), nb('a', '2')]
        const before = names(list)
        sortNotebooks(list, { field: 'name', direction: 'asc' })
        expect(names(list)).toEqual(before)
    })

    test('keeps every notebook', () => {
        const list = [nb('a', '1'), nb('b', '2'), nb('c', '3')]
        for (const mode of SORT_MODES) {
            expect(sortNotebooks(list, mode.mode)).toHaveLength(3)
        }
    })

    test('an empty list stays empty', () => {
        expect(sortNotebooks([], { field: 'name', direction: 'asc' })).toEqual([])
    })

    test('a single notebook is returned unchanged', () => {
        expect(
            names(sortNotebooks([nb('only', '1')], { field: 'modified', direction: 'desc' }))
        ).toEqual(['only'])
    })
})
