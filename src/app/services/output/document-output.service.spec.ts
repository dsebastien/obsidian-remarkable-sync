import { test, expect, describe } from 'bun:test'
import type { Vault } from 'obsidian'
import { renderAndWritePages, resolvePdfImageFormat } from './document-output.service'
import type { DocumentOutputDeps } from './document-output.service'
import type { PdfPageImage } from './pdf-writer.service'
import type { Page } from '../../domain/notebook'
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
}

function createHarness(
    options: { failingPages?: number[]; pdfBuildFails?: boolean } = {}
): Harness {
    const renderCalls: Harness['renderCalls'] = []
    const imageWrites: Harness['imageWrites'] = []
    const pdfWrites: Harness['pdfWrites'] = []
    const pdfPages: PdfPageImage[][] = []

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
        }
    }

    return { deps, renderCalls, imageWrites, pdfWrites, pdfPages }
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
