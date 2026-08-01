import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { buildPdf, pixelsToPoints, REMARKABLE_DPI } from './pdf-writer.service'
import type { PdfPageImage } from './pdf-writer.service'

/**
 * Real 12x16 images, not synthetic byte blobs: pdf-lib parses the JPEG SOF
 * marker and the PNG IHDR to discover dimensions, so a fake would never embed.
 * The PNG is hand-built (truecolor, filter 0); the JPEG is that PNG converted
 * by `sips`, so it is an ordinary baseline JPEG.
 */
const FIXTURE_WIDTH = 12
const FIXTURE_HEIGHT = 16

function loadFixture(name: string): ArrayBuffer {
    const data = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))
    const copy = new ArrayBuffer(data.byteLength)
    new Uint8Array(copy).set(data)
    return copy
}

function jpegPage(): PdfPageImage {
    return { data: loadFixture('page.jpg'), format: 'jpeg' }
}

function pngPage(): PdfPageImage {
    return { data: loadFixture('page.png'), format: 'png' }
}

const sha = async (buffer: ArrayBuffer): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('pixelsToPoints', () => {
    test('converts the standard reMarkable page to points', () => {
        // 1404x1872 px at 226 DPI is 447.29 x 596.39 pt
        expect(pixelsToPoints(1404)).toBeCloseTo(447.292, 2)
        expect(pixelsToPoints(1872)).toBeCloseTo(596.389, 2)
    })

    test('one inch of pixels is 72 points', () => {
        expect(pixelsToPoints(REMARKABLE_DPI)).toBe(72)
    })

    test('zero maps to zero', () => {
        expect(pixelsToPoints(0)).toBe(0)
    })
})

describe('buildPdf', () => {
    test('returns null for an empty page list rather than a corrupt file', async () => {
        expect(await buildPdf([])).toBeNull()
    })

    test('produces one PDF page per image', async () => {
        const page = jpegPage()
        const bytes = await buildPdf([page, page, page])
        expect(bytes).not.toBeNull()

        const doc = await PDFDocument.load(bytes!)
        expect(doc.getPageCount()).toBe(3)
    })

    test('sizes each page from its own image at 226 DPI', async () => {
        const bytes = await buildPdf([jpegPage()])
        const doc = await PDFDocument.load(bytes!)
        const { width, height } = doc.getPage(0).getSize()

        expect(width).toBeCloseTo(pixelsToPoints(FIXTURE_WIDTH), 3)
        expect(height).toBeCloseTo(pixelsToPoints(FIXTURE_HEIGHT), 3)
    })

    test('keeps per-page sizes independent, so a grown page stays taller', async () => {
        // A page whose canvas grew downward for scrolled content must not be
        // squashed onto the first page's box.
        const jpeg = jpegPage()
        const bytes = await buildPdf([jpeg, jpeg])
        const doc = await PDFDocument.load(bytes!)

        expect(doc.getPage(0).getSize().height).toBeCloseTo(doc.getPage(1).getSize().height, 3)
    })

    test('embeds PNG as well as JPEG', async () => {
        const bytes = await buildPdf([pngPage()])
        expect(bytes).not.toBeNull()

        const doc = await PDFDocument.load(bytes!)
        expect(doc.getPageCount()).toBe(1)
        expect(doc.getPage(0).getSize().width).toBeCloseTo(pixelsToPoints(FIXTURE_WIDTH), 3)
    })

    test('mixes formats across pages', async () => {
        const bytes = await buildPdf([jpegPage(), pngPage()])
        const doc = await PDFDocument.load(bytes!)
        expect(doc.getPageCount()).toBe(2)
    })

    test('is byte-identical across runs, so re-syncing never churns vault sync', async () => {
        const first = await buildPdf([jpegPage(), pngPage()])
        await new Promise((resolve) => setTimeout(resolve, 1100)) // cross a second boundary
        const second = await buildPdf([jpegPage(), pngPage()])

        expect(await sha(first!)).toBe(await sha(second!))
    })

    test('carries no creation date, modification date, producer or file ID', async () => {
        const bytes = await buildPdf([jpegPage()])
        const text = new TextDecoder('latin1').decode(bytes!)

        expect(text).not.toContain('CreationDate')
        expect(text).not.toContain('ModDate')
        expect(text).not.toContain('Producer')
        expect(text).not.toMatch(/\/ID\s*\[/)
    })

    test('output is a readable PDF', async () => {
        const bytes = await buildPdf([jpegPage()])
        const header = new TextDecoder('latin1').decode(bytes!.slice(0, 8))

        expect(header.startsWith('%PDF-')).toBe(true)
        expect(new TextDecoder('latin1').decode(bytes!).trimEnd().endsWith('%%EOF')).toBe(true)
    })

    test('returns null instead of throwing when the image cannot be parsed', async () => {
        const garbage: PdfPageImage = { data: new Uint8Array([1, 2, 3, 4]).buffer, format: 'jpeg' }
        expect(await buildPdf([garbage])).toBeNull()
    })
})
