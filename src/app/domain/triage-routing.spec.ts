import { test, expect, describe } from 'bun:test'
import { selectPagesToRoute, DEFAULT_TRIAGE_IDLE_MINUTES } from './triage-routing'
import type { SyncStore, NotebookSyncState, PageOcrState } from './sync-state'

const HOUR = 60 * 60 * 1000
const NOW = 1_000_000_000_000

function page(overrides: Partial<PageOcrState> = {}): PageOcrState {
    return { pageId: 'p1', srcHash: 'src-1', ocrHash: 'ocr-1', pageIndex: 0, ...overrides }
}

function notebook(overrides: Partial<NotebookSyncState> = {}): NotebookSyncState {
    return {
        remarkableId: 'nb-1',
        lastSyncedAt: NOW - HOUR,
        lastModifiedCloud: NOW - 2 * HOUR,
        syncedPageCount: 1,
        visibleName: 'My Notebook',
        folderPath: '2026',
        pages: { p1: page() },
        ...overrides
    }
}

function store(notebooks: Record<string, NotebookSyncState>): SyncStore {
    return { notebooks }
}

describe('selectPagesToRoute', () => {
    test('DEFAULT_TRIAGE_IDLE_MINUTES is 60 (1h)', () => {
        expect(DEFAULT_TRIAGE_IDLE_MINUTES).toBe(60)
    })

    test('routes an OCRd page whose notebook has been idle past the threshold', () => {
        const s = store({ 'nb-1': notebook() })
        const out = selectPagesToRoute(s, NOW, HOUR)
        expect(out).toHaveLength(1)
        expect(out[0]).toMatchObject({
            notebookId: 'nb-1',
            notebookName: 'My Notebook',
            folderPath: '2026',
            pageId: 'p1',
            pageIndex: 0,
            srcHash: 'src-1'
        })
    })

    test('does not route when the notebook was modified less than the idle threshold ago', () => {
        const s = store({
            'nb-1': notebook({ lastModifiedCloud: NOW - 30 * 60 * 1000 }) // 30 min ago
        })
        expect(selectPagesToRoute(s, NOW, HOUR)).toHaveLength(0)
    })

    test('does not route a page that has never been OCRd (empty ocrHash)', () => {
        const s = store({
            'nb-1': notebook({ pages: { p1: page({ ocrHash: '' }) } })
        })
        expect(selectPagesToRoute(s, NOW, HOUR)).toHaveLength(0)
    })

    test('does not route a page whose current content was already routed (dedup)', () => {
        const s = store({
            'nb-1': notebook({
                pages: { p1: page({ routedSrcHash: 'src-1', routedAt: NOW - HOUR }) }
            })
        })
        expect(selectPagesToRoute(s, NOW, HOUR)).toHaveLength(0)
    })

    test('re-routes a page that was edited after being routed (srcHash advanced)', () => {
        const s = store({
            'nb-1': notebook({
                pages: {
                    p1: page({ srcHash: 'src-2', ocrHash: 'ocr-2', routedSrcHash: 'src-1' })
                }
            })
        })
        const out = selectPagesToRoute(s, NOW, HOUR)
        expect(out).toHaveLength(1)
        expect(out[0]!.srcHash).toBe('src-2')
    })

    test('never-synced notebook (lastSyncedAt 0) is skipped', () => {
        const s = store({
            'nb-1': notebook({ lastSyncedAt: 0, lastModifiedCloud: NOW - 10 * HOUR })
        })
        expect(selectPagesToRoute(s, NOW, HOUR)).toHaveLength(0)
    })

    test('backlog notebook — cloud mtime long in the past, first OCR today — routes immediately', () => {
        // e.g. a notebook last edited a week ago, only just OCR'd for the first
        // time this run. Idle time is measured from the cloud mtime, not from
        // "when we first observed it", so this must NOT wait another hour.
        const weekAgo = NOW - 7 * 24 * HOUR
        const s = store({
            'nb-1': notebook({ lastSyncedAt: NOW - 60_000, lastModifiedCloud: weekAgo })
        })
        expect(selectPagesToRoute(s, NOW, HOUR)).toHaveLength(1)
    })

    test('partially-OCRd notebook (mtime held back by the pipeline) is not routed', () => {
        // The pipeline holds lastModifiedCloud at its PRIOR value until every
        // page is OCR'd. Simulate that: the notebook's real cloud edit was
        // recent (2h ago, i.e. old prior mtime), and one page still lacks OCR.
        const s = store({
            'nb-1': notebook({
                lastModifiedCloud: NOW - 2 * HOUR,
                pages: {
                    p1: page({ ocrHash: 'ocr-1' }),
                    p2: page({ pageId: 'p2', srcHash: 'src-2', ocrHash: '' })
                }
            })
        })
        const out = selectPagesToRoute(s, NOW, HOUR)
        // p1 is eligible (notebook-level mtime is old enough); p2 has no OCR yet.
        expect(out.map((c) => c.pageId)).toEqual(['p1'])
    })

    test('multiple notebooks: only idle ones contribute candidates', () => {
        const s = store({
            'nb-1': notebook({ remarkableId: 'nb-1' }),
            'nb-2': notebook({
                remarkableId: 'nb-2',
                lastModifiedCloud: NOW - 5 * 60 * 1000, // 5 min ago — still active
                pages: { p1: page({ pageId: 'q1' }) }
            })
        })
        const out = selectPagesToRoute(s, NOW, HOUR)
        expect(out.map((c) => c.notebookId)).toEqual(['nb-1'])
    })

    test('notebook with no pages map yields no candidates', () => {
        const s = store({ 'nb-1': notebook({ pages: undefined }) })
        expect(selectPagesToRoute(s, NOW, HOUR)).toHaveLength(0)
    })

    test('empty store yields no candidates', () => {
        expect(selectPagesToRoute(store({}), NOW, HOUR)).toHaveLength(0)
    })
})
