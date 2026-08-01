import { test, expect, describe } from 'bun:test'
import type { Vault } from 'obsidian'
import { renderAndWritePages, resolvePdfImageFormat } from './document-output.service'
import type { DocumentOutputDeps } from './document-output.service'
import type { PdfPageImage } from './pdf-writer.service'
import type { Page, SourceDocument } from '../../domain/notebook'
import { DEFAULT_SETTINGS } from '../../types/plugin-settings.intf'
import type { PluginSettings } from '../../types/plugin-settings.intf'

const page = (pageIndex: number): Page => ({
    pageId: `p${pageIndex}`,
    pageIndex,
    strokes: []
})

interface Harness {
    deps: DocumentOutputDeps
    renderCalls: { pageIndex: number; format: string }[]
    imageWrites: { pageIndex: number; format: string }[]
    pdfWrites: { name: string }[]
    pdfPages: PdfPageImage[][]
    annotateCalls: { bytes: number; layers: number }[]
    notesWritten: { name: string; contents: string }[]
}

function createHarness(
    options: { failingPages?: number[]; pdfBuildFails?: boolean; annotateFails?: boolean } = {}
): Harness {
    const renderCalls: Harness['renderCalls'] = []
    const imageWrites: Harness['imageWrites'] = []
    const pdfWrites: Harness['pdfWrites'] = []
    const pdfPages: PdfPageImage[][] = []
    const annotateCalls: Harness['annotateCalls'] = []
    const notesWritten: Harness['notesWritten'] = []

    const deps: DocumentOutputDeps = {
        renderPage: (p, format): Promise<ArrayBuffer | null> => {
            renderCalls.push({ pageIndex: p.pageIndex, format: format ?? 'jpeg' })
            if (options.failingPages?.includes(p.pageIndex)) return Promise.resolve(null)
            return Promise.resolve(new ArrayBuffer(4))
        },
        writePageImage: (_vault, _target, _folder, _name, pageIndex, _data, format) => {
            imageWrites.push({ pageIndex, format })
            return Promise.resolve('path')
        },
        buildPdf: (pages): Promise<ArrayBuffer | null> => {
            pdfPages.push([...pages])
            return Promise.resolve(options.pdfBuildFails ? null : new ArrayBuffer(16))
        },
        writeDocumentPdf: (_vault, _target, _folder, name): Promise<string> => {
            pdfWrites.push({ name })
            return Promise.resolve(`${name}.pdf`)
        },
        writeMarkdownNote: (_vault, _target, _folder, name, contents): Promise<string> => {
            notesWritten.push({ name, contents })
            return Promise.resolve(`${name}.md`)
        },
        annotateSourcePdf: (data, pages) => {
            annotateCalls.push({ bytes: data.byteLength, layers: pages.length })
            if (options.annotateFails) return Promise.resolve(null)
            const annotatable = pages.filter((p) => p.sourcePageIndex !== undefined)
            return Promise.resolve({
                data: new ArrayBuffer(32),
                annotatedPages: annotatable.length,
                skippedPages: pages.length - annotatable.length,
                highlights: pages.reduce((n, p) => n + (p.highlights?.length ?? 0), 0)
            })
        }
    }

    return { deps, renderCalls, imageWrites, pdfWrites, pdfPages, annotateCalls, notesWritten }
}

async function run(
    harness: Harness,
    settings: Partial<PluginSettings>,
    pages: Page[] = [page(0), page(1)]
): Promise<Awaited<ReturnType<typeof renderAndWritePages>>> {
    return renderAndWritePages(
        {
            pages,
            notebookName: 'Notebook',
            folderPath: 'Work',
            settings: { ...DEFAULT_SETTINGS, ...settings },
            vault: {} as Vault,
            onPageProgress: () => {}
        },
        harness.deps
    )
}

describe('resolvePdfImageFormat', () => {
    test('JPEG and PNG embed as themselves', () => {
        expect(resolvePdfImageFormat('jpeg')).toBe('jpeg')
        expect(resolvePdfImageFormat('png')).toBe('png')
    })

    test('WebP falls back to JPEG, since a PDF has no WebP filter', () => {
        expect(resolvePdfImageFormat('webp')).toBe('jpeg')
    })
})

describe('renderAndWritePages toggle combinations', () => {
    test('images only: writes images, builds no PDF', async () => {
        const h = createHarness()
        const result = await run(h, { saveImages: true, savePdf: false })

        expect(h.imageWrites).toHaveLength(2)
        expect(h.pdfWrites).toHaveLength(0)
        expect(result.pdfWritten).toBe(false)
        expect(result.totalPages).toBe(2)
    })

    test('PDF only: writes one PDF, no loose images', async () => {
        const h = createHarness()
        const result = await run(h, { saveImages: false, savePdf: true })

        expect(h.imageWrites).toHaveLength(0)
        expect(h.pdfWrites).toEqual([{ name: 'Notebook' }])
        expect(result.pdfWritten).toBe(true)
    })

    test('both: writes images and one PDF', async () => {
        const h = createHarness()
        await run(h, { saveImages: true, savePdf: true })

        expect(h.imageWrites).toHaveLength(2)
        expect(h.pdfWrites).toEqual([{ name: 'Notebook' }])
    })

    test('neither: writes nothing but still renders, so failures stay counted', async () => {
        const h = createHarness()
        const result = await run(h, { saveImages: false, savePdf: false })

        expect(h.imageWrites).toHaveLength(0)
        expect(h.pdfWrites).toHaveLength(0)
        expect(h.renderCalls).toHaveLength(2)
        expect(result.totalPages).toBe(2)
    })
})

describe('renderAndWritePages encoding', () => {
    test('renders each page once when both outputs share an encoding', async () => {
        const h = createHarness()
        await run(h, { saveImages: true, savePdf: true, imageFormat: 'jpeg' })

        expect(h.renderCalls).toHaveLength(2)
        expect(h.renderCalls.every((c) => c.format === 'jpeg')).toBe(true)
    })

    test('WebP with PDF renders twice: WebP for the file, JPEG for the PDF', async () => {
        const h = createHarness()
        await run(h, { saveImages: true, savePdf: true, imageFormat: 'webp' })

        expect(h.renderCalls).toHaveLength(4)
        expect(h.renderCalls.filter((c) => c.format === 'webp')).toHaveLength(2)
        expect(h.renderCalls.filter((c) => c.format === 'jpeg')).toHaveLength(2)
        expect(h.imageWrites.every((w) => w.format === 'webp')).toBe(true)
        expect(h.pdfPages[0]!.every((p) => p.format === 'jpeg')).toBe(true)
    })

    test('WebP without loose images renders JPEG once per page', async () => {
        const h = createHarness()
        await run(h, { saveImages: false, savePdf: true, imageFormat: 'webp' })

        expect(h.renderCalls).toHaveLength(2)
        expect(h.renderCalls.every((c) => c.format === 'jpeg')).toBe(true)
    })

    test('PNG embeds as PNG', async () => {
        const h = createHarness()
        await run(h, { saveImages: false, savePdf: true, imageFormat: 'png' })

        expect(h.pdfPages[0]!.every((p) => p.format === 'png')).toBe(true)
    })
})

describe('renderAndWritePages failures', () => {
    test('a failed page is counted and excluded from both outputs', async () => {
        const h = createHarness({ failingPages: [1] })
        const result = await run(h, { saveImages: true, savePdf: true }, [
            page(0),
            page(1),
            page(2)
        ])

        expect(result.totalPages).toBe(3)
        expect(result.failedPages).toBe(1)
        expect(h.imageWrites.map((w) => w.pageIndex)).toEqual([0, 2])
        expect(h.pdfPages[0]).toHaveLength(2)
    })

    test('every page failing writes no PDF at all', async () => {
        const h = createHarness({ failingPages: [0, 1] })
        const result = await run(h, { saveImages: false, savePdf: true })

        expect(result.failedPages).toBe(2)
        expect(h.pdfWrites).toHaveLength(0)
        expect(result.pdfWritten).toBe(false)
    })

    test('a PDF that cannot be built is reported, not written', async () => {
        const h = createHarness({ pdfBuildFails: true })
        const result = await run(h, { saveImages: true, savePdf: true })

        expect(h.imageWrites).toHaveLength(2)
        expect(h.pdfWrites).toHaveLength(0)
        expect(result.pdfWritten).toBe(false)
    })
})

describe('renderAndWritePages progress', () => {
    test('reports each page in order with the running failure count', async () => {
        const h = createHarness({ failingPages: [0] })
        const seen: number[][] = []

        await renderAndWritePages(
            {
                pages: [page(0), page(1), page(2)],
                notebookName: 'Notebook',
                folderPath: '',
                settings: { ...DEFAULT_SETTINGS },
                vault: {} as Vault,
                onPageProgress: (current, total, failed) => seen.push([current, total, failed])
            },
            h.deps
        )

        expect(seen).toEqual([
            [1, 3, 0],
            [2, 3, 1],
            [3, 3, 1]
        ])
    })
})

const sourcePdf = (): SourceDocument => ({ kind: 'pdf', data: new ArrayBuffer(2048) })

const sourcePage = (pageIndex: number, sourcePageIndex?: number): Page => ({
    pageId: `sp${pageIndex}`,
    pageIndex,
    strokes: [],
    ...(sourcePageIndex === undefined ? {} : { sourcePageIndex })
})

async function runSourceBacked(
    h: Harness,
    settings: Partial<PluginSettings>,
    pages: Page[],
    source: SourceDocument | null = sourcePdf()
): Promise<Awaited<ReturnType<typeof renderAndWritePages>>> {
    return renderAndWritePages(
        {
            pages,
            notebookName: 'Book',
            folderPath: 'Work',
            settings: { ...DEFAULT_SETTINGS, ...settings },
            vault: {} as Vault,
            onPageProgress: () => {},
            ...(source ? { sourceDocument: source } : {})
        },
        h.deps
    )
}

describe('source-backed documents', () => {
    test('writes the source through and an annotated copy beside it', async () => {
        const h = createHarness()
        const result = await runSourceBacked(h, { savePdf: true, saveImages: false }, [
            sourcePage(0, 0)
        ])

        expect(h.pdfWrites.map((w) => w.name)).toEqual(['Book', 'Book (annotated)'])
        expect(result.sourceWritten).toBe(true)
        expect(result.annotatedWritten).toBe(true)
    })

    /**
     * The bug this whole phase exists to fix: assembling page images into a PDF
     * would discard the original document and leave ink on blank pages.
     */
    test('never assembles page images into a PDF when a source exists', async () => {
        const h = createHarness()
        await runSourceBacked(h, { savePdf: true, saveImages: false }, [sourcePage(0, 0)])

        expect(h.pdfPages).toHaveLength(0)
        expect(h.annotateCalls).toHaveLength(1)
    })

    test('writes nothing extra when savePdf is off', async () => {
        const h = createHarness()
        const result = await runSourceBacked(h, { savePdf: false, saveImages: true }, [
            sourcePage(0, 0)
        ])

        expect(h.pdfWrites).toHaveLength(0)
        expect(result.sourceWritten).toBe(false)
        expect(result.annotatedWritten).toBe(false)
    })

    test('still writes the source when no layer maps to a source page', async () => {
        const h = createHarness()
        // Every layer sits on a device-inserted page
        const result = await runSourceBacked(h, { savePdf: true, saveImages: false }, [
            sourcePage(0),
            sourcePage(1)
        ])

        expect(h.pdfWrites.map((w) => w.name)).toEqual(['Book'])
        expect(result.sourceWritten).toBe(true)
        expect(result.annotatedWritten).toBe(false)
    })

    test('a failed annotation still leaves the source in the vault', async () => {
        const h = createHarness({ annotateFails: true })
        const result = await runSourceBacked(h, { savePdf: true, saveImages: false }, [
            sourcePage(0, 0)
        ])

        expect(h.pdfWrites.map((w) => w.name)).toEqual(['Book'])
        expect(result.sourceWritten).toBe(true)
        expect(result.annotatedWritten).toBe(false)
    })

    test('an EPUB source is written through but never annotated', async () => {
        const h = createHarness()
        const result = await runSourceBacked(
            h,
            { savePdf: true, saveImages: false },
            [sourcePage(0, 0)],
            { kind: 'epub', data: new ArrayBuffer(64) }
        )

        expect(h.pdfWrites.map((w) => w.name)).toEqual(['Book'])
        expect(h.annotateCalls).toHaveLength(0)
        expect(result.annotatedWritten).toBe(false)
    })

    test('a notebook is unaffected and still assembles its images', async () => {
        const h = createHarness()
        const result = await runSourceBacked(
            h,
            { savePdf: true, saveImages: false },
            [page(0), page(1)],
            null
        )

        expect(h.pdfPages).toHaveLength(1)
        expect(result.pdfWritten).toBe(true)
        expect(result.sourceWritten).toBe(false)
    })
})

const highlightedPage = (pageIndex: number, sourcePageIndex = 0): Page => ({
    pageId: `hp${pageIndex}`,
    pageIndex,
    strokes: [],
    sourcePageIndex,
    highlights: [{ text: 'Some highlighted words', color: 9 as never, rects: [] }]
})

describe('highlights note toggle', () => {
    test('off by default: no note is written even when highlights exist', async () => {
        const h = createHarness()
        const result = await runSourceBacked(h, { savePdf: true, saveImages: false }, [
            highlightedPage(0)
        ])

        expect(h.notesWritten).toHaveLength(0)
        expect(result.highlightsNoteWritten).toBe(false)
    })

    test('on: writes one note named after the document', async () => {
        const h = createHarness()
        const result = await runSourceBacked(
            h,
            { savePdf: true, saveImages: false, saveHighlightsNote: true },
            [highlightedPage(0)]
        )

        expect(h.notesWritten.map((n) => n.name)).toEqual(['Book (highlights)'])
        expect(h.notesWritten[0]!.contents).toContain('Some highlighted words')
        expect(result.highlightsNoteWritten).toBe(true)
    })

    test('on but no highlights: still no note, so vaults stay quiet', async () => {
        const h = createHarness()
        const result = await runSourceBacked(
            h,
            { savePdf: true, saveImages: false, saveHighlightsNote: true },
            [sourcePage(0, 0)]
        )

        expect(h.notesWritten).toHaveLength(0)
        expect(result.highlightsNoteWritten).toBe(false)
    })

    /**
     * The toggle governs the markdown only. Highlights are embedded in the
     * annotated PDF either way, since that is part of reproducing the document
     * faithfully rather than an extra output.
     */
    test('the annotated PDF is written regardless of the toggle', async () => {
        for (const saveHighlightsNote of [true, false]) {
            const h = createHarness()
            const result = await runSourceBacked(
                h,
                { savePdf: true, saveImages: false, saveHighlightsNote },
                [highlightedPage(0)]
            )
            expect(result.annotatedWritten).toBe(true)
            expect(h.annotateCalls).toHaveLength(1)
        }
    })

    test('works without a PDF: the note does not depend on savePdf', async () => {
        const h = createHarness()
        const result = await runSourceBacked(
            h,
            { savePdf: false, saveImages: false, saveHighlightsNote: true },
            [highlightedPage(0)]
        )

        expect(h.pdfWrites).toHaveLength(0)
        expect(result.highlightsNoteWritten).toBe(true)
    })
})
