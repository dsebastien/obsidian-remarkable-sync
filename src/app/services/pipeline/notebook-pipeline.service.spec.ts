import { test, expect, describe } from 'bun:test'
import { createNotebookPipelineService } from './notebook-pipeline.service'
import type { PipelineDeps, PipelineProgress } from './notebook-pipeline.service'
import type { RemarkableSyncPlugin } from '../../plugin'
import { DEFAULT_SETTINGS } from '../../types/plugin-settings.intf'
import type { Notebook, NotebookSummary, Page } from '../../domain/notebook'
import { PenType, StrokeColor } from '../../domain/notebook'

function contentPage(pageIndex: number): Page {
    return {
        pageId: `page-${pageIndex}`,
        pageIndex,
        strokes: [
            {
                penType: PenType.FinelinerV2,
                color: StrokeColor.Black,
                thickness: 2,
                points: [{ x: 0, y: 0, speed: 1, width: 2, direction: 0, pressure: 1 }]
            }
        ]
    }
}

function summary(): NotebookSummary {
    return {
        id: 'nb-1',
        visibleName: 'Test notebook',
        parent: '',
        lastModified: '1700000000000',
        pageCount: 3,
        folderPath: ''
    }
}

interface Harness {
    service: ReturnType<typeof createNotebookPipelineService>
    progress: PipelineProgress[]
    written: number[]
    pdfsWritten: string[]
    updateStateCalls: { remarkableId: string; syncedPageCount: number }[]
}

function createHarness(config: {
    pages: Page[]
    /** pageIndexes whose render fails (returns null) */
    failingPages?: number[]
    downloadFails?: boolean
    settings?: Partial<typeof DEFAULT_SETTINGS>
}): Harness {
    const progress: PipelineProgress[] = []
    const written: number[] = []
    const pdfsWritten: string[] = []
    const updateStateCalls: Harness['updateStateCalls'] = []

    const fakePlugin = {
        settings: { ...DEFAULT_SETTINGS, ...config.settings },
        app: { vault: {} },
        cloudService: {
            downloadDocument: (): Promise<Map<string, ArrayBuffer> | null> =>
                Promise.resolve(config.downloadFails ? null : new Map<string, ArrayBuffer>())
        },
        syncStoreService: {
            updateState: (
                remarkableId: string,
                _lastModifiedCloud: number,
                syncedPageCount: number
            ): Promise<void> => {
                updateStateCalls.push({ remarkableId, syncedPageCount })
                return Promise.resolve()
            }
        }
    } as unknown as RemarkableSyncPlugin

    const notebook: Notebook = {
        id: 'nb-1',
        visibleName: 'Test notebook',
        parent: '',
        lastModified: '1700000000000',
        pageCount: config.pages.length,
        pages: config.pages
    }

    const deps: PipelineDeps = {
        parseDocument: () => notebook,
        renderPage: (page): Promise<ArrayBuffer | null> =>
            Promise.resolve(
                config.failingPages?.includes(page.pageIndex) ? null : new ArrayBuffer(4)
            ),
        writePageImage: (_vault, _target, _folder, _name, pageIndex): Promise<string> => {
            written.push(pageIndex)
            return Promise.resolve(`path-${pageIndex}`)
        },
        buildPdf: (): Promise<ArrayBuffer | null> => Promise.resolve(new ArrayBuffer(8)),
        writeDocumentPdf: (_vault, _target, _folder, name): Promise<string> => {
            pdfsWritten.push(name)
            return Promise.resolve(`${name}.pdf`)
        },
        annotateSourcePdf: () =>
            Promise.resolve({ data: new ArrayBuffer(16), annotatedPages: 1, skippedPages: 0 })
    }

    const service = createNotebookPipelineService(fakePlugin, deps)
    return { service, progress, written, pdfsWritten, updateStateCalls }
}

describe('processNotebook', () => {
    test('reports done without failures when every page renders', async () => {
        const harness = createHarness({ pages: [contentPage(0), contentPage(1)] })

        const ok = await harness.service.processNotebook(summary(), (p) => harness.progress.push(p))

        expect(ok).toBe(true)
        const done = harness.progress.at(-1)!
        expect(done.status).toBe('done')
        expect(done.failedPages).toBe(0)
        expect(harness.written).toEqual([0, 1])
        expect(harness.updateStateCalls).toEqual([{ remarkableId: 'nb-1', syncedPageCount: 2 }])
    })

    test('counts and reports pages that fail to render instead of dropping them silently', async () => {
        const harness = createHarness({
            pages: [contentPage(0), contentPage(1), contentPage(2)],
            failingPages: [1]
        })

        const ok = await harness.service.processNotebook(summary(), (p) => harness.progress.push(p))

        expect(ok).toBe(true)
        const done = harness.progress.at(-1)!
        expect(done.status).toBe('done')
        expect(done.totalPages).toBe(3)
        expect(done.failedPages).toBe(1)
        expect(harness.written).toEqual([0, 2])
    })

    test('only successfully rendered pages count toward sync state', async () => {
        const harness = createHarness({
            pages: [contentPage(0), contentPage(1), contentPage(2)],
            failingPages: [0, 2]
        })

        await harness.service.processNotebook(summary(), (p) => harness.progress.push(p))

        expect(harness.updateStateCalls).toEqual([{ remarkableId: 'nb-1', syncedPageCount: 1 }])
    })

    test('reports an error status when the download fails', async () => {
        const harness = createHarness({ pages: [contentPage(0)], downloadFails: true })

        const ok = await harness.service.processNotebook(summary(), (p) => harness.progress.push(p))

        expect(ok).toBe(false)
        expect(harness.progress.at(-1)!.status).toBe('error')
        expect(harness.updateStateCalls).toEqual([])
    })

    test('writes no PDF by default, so existing installs are unaffected', async () => {
        const harness = createHarness({ pages: [contentPage(0), contentPage(1)] })

        await harness.service.processNotebook(summary(), (p) => harness.progress.push(p))

        expect(harness.pdfsWritten).toEqual([])
        expect(harness.written).toEqual([0, 1])
    })

    test('writes one PDF per notebook when savePdf is enabled', async () => {
        const harness = createHarness({
            pages: [contentPage(0), contentPage(1)],
            settings: { savePdf: true }
        })

        await harness.service.processNotebook(summary(), (p) => harness.progress.push(p))

        expect(harness.pdfsWritten).toEqual(['Test notebook'])
        // Both outputs, since saveImages defaults to true
        expect(harness.written).toEqual([0, 1])
    })

    test('PDF only leaves no loose images behind', async () => {
        const harness = createHarness({
            pages: [contentPage(0), contentPage(1)],
            settings: { savePdf: true, saveImages: false }
        })

        await harness.service.processNotebook(summary(), (p) => harness.progress.push(p))

        expect(harness.pdfsWritten).toEqual(['Test notebook'])
        expect(harness.written).toEqual([])
    })

    test('sync state still counts rendered pages when only a PDF is written', async () => {
        const harness = createHarness({
            pages: [contentPage(0), contentPage(1), contentPage(2)],
            failingPages: [2],
            settings: { savePdf: true, saveImages: false }
        })

        await harness.service.processNotebook(summary(), (p) => harness.progress.push(p))

        expect(harness.updateStateCalls).toEqual([{ remarkableId: 'nb-1', syncedPageCount: 2 }])
    })
})
