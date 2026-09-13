import { test, expect, describe } from 'bun:test'
import {
    PAGE_RENDERING_UNSUPPORTED_MESSAGE,
    isPageRenderingSupported,
    renderPage,
    renderPageToCanvas
} from './page-renderer.service'
import { PAGE_WIDTH, PAGE_HEIGHT } from '../../domain/rm-constants'
import { PenType, StrokeColor } from '../../domain/notebook'
import type { Page, PageImage, Stroke } from '../../domain/notebook'

/** Run `body` with `OffscreenCanvas` removed from the global scope. */
function withoutOffscreenCanvas(body: () => void): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
    // @ts-expect-error -- deliberately removing a global to simulate an older webview
    delete globalThis.OffscreenCanvas
    try {
        body()
    } finally {
        if (original) {
            Object.defineProperty(globalThis, 'OffscreenCanvas', original)
        }
    }
}

/** A canvas stub that records what was painted onto it. */
class FakeCtx {
    ops: string[] = []
    fillStyle = ''
    fillRect(): void {
        this.ops.push('fillRect')
    }
    translate(): void {
        this.ops.push('translate')
    }
    drawImage(): void {
        this.ops.push('drawImage')
    }
    beginPath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    stroke(): void {
        this.ops.push('stroke')
    }
    arc(): void {}
    fill(): void {
        this.ops.push('fill')
    }
    save(): void {}
    restore(): void {}
    set lineWidth(_v: number) {}
    set lineCap(_v: string) {}
    set lineJoin(_v: string) {}
    set strokeStyle(_v: string) {}
    set globalAlpha(_v: number) {}
}

interface CanvasRecord {
    width: number
    height: number
    ctx: FakeCtx
}

/**
 * Swap in stubbed `OffscreenCanvas` / `createImageBitmap` for one async body.
 *
 * `bun test` has neither, which is why the renderer had no coverage and why
 * every finding downstream of the parser passed the full suite.
 */
async function withStubbedCanvas(
    opts: { decode: 'ok' | 'reject' | 'absent'; maxArea?: number },
    body: (canvases: CanvasRecord[]) => Promise<void>
): Promise<void> {
    const canvases: CanvasRecord[] = []
    const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
    const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')

    class CanvasStub {
        width: number
        height: number
        ctx = new FakeCtx()
        constructor(width: number, height: number) {
            if (opts.maxArea !== undefined && width * height > opts.maxArea) {
                throw new RangeError('canvas too large')
            }
            this.width = width
            this.height = height
            canvases.push({ width, height, ctx: this.ctx })
        }
        getContext(): FakeCtx {
            return this.ctx
        }
        convertToBlob(): Promise<Blob> {
            return Promise.resolve({
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(16))
            } as unknown as Blob)
        }
    }

    Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: CanvasStub,
        configurable: true,
        writable: true
    })

    if (opts.decode === 'absent') {
        // Reflect rather than `delete`, which needs a ts-expect-error the
        // repo's rule gate refuses.
        Reflect.deleteProperty(globalThis, 'createImageBitmap')
    } else {
        Object.defineProperty(globalThis, 'createImageBitmap', {
            value:
                opts.decode === 'ok'
                    ? () => Promise.resolve({ close: () => {} })
                    : () => Promise.reject(new Error('corrupt image')),
            configurable: true,
            writable: true
        })
    }

    try {
        await body(canvases)
    } finally {
        if (originalCanvas) Object.defineProperty(globalThis, 'OffscreenCanvas', originalCanvas)
        if (originalBitmap) {
            Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap)
        } else {
            Reflect.deleteProperty(globalThis, 'createImageBitmap')
        }
    }
}

function image(over: Partial<PageImage> = {}): PageImage {
    return {
        assetId: 'asset',
        fileName: 'capture.png',
        x: -100,
        y: 200,
        width: 400,
        height: 300,
        data: new ArrayBuffer(8),
        ...over
    }
}

function stroke(): Stroke {
    return {
        penType: PenType.FinelinerV2,
        color: StrokeColor.Black,
        thickness: 2,
        // Two points so the renderer paints a line; a single point is drawn
        // as a dot via fill() instead.
        points: [
            { x: 0, y: 0, speed: 1, width: 2, direction: 0, pressure: 1 },
            { x: 50, y: 60, speed: 1, width: 2, direction: 0, pressure: 1 }
        ]
    }
}

function page(strokes: Stroke[], images: PageImage[]): Page {
    return { pageId: 'p', pageIndex: 0, strokes, images }
}

describe('isPageRenderingSupported', () => {
    test('is true where OffscreenCanvas exists', () => {
        // Stubbed by `src/test-setup.ts`; bun's runtime has no browser APIs.
        expect(isPageRenderingSupported()).toBe(true)
    })

    test('is false on a webview without OffscreenCanvas', () => {
        // iOS before 16.4. Without this check every page fails to render and
        // the user is told only that "N pages failed to render".
        withoutOffscreenCanvas(() => {
            expect(isPageRenderingSupported()).toBe(false)
        })
    })

    test('the message names the requirement', () => {
        expect(PAGE_RENDERING_UNSUPPORTED_MESSAGE).toContain('16.4')
    })
})

describe('renderPageToCanvas', () => {
    /** A canvas stub rich enough for the blank-page path. */
    class DrawableOffscreenCanvas {
        constructor(
            public width: number,
            public height: number
        ) {}
        getContext(): unknown {
            return { fillStyle: '', fillRect: () => {}, translate: () => {} }
        }
    }

    function withDrawableCanvas<T>(body: () => T): T {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
        Object.defineProperty(globalThis, 'OffscreenCanvas', {
            value: DrawableOffscreenCanvas,
            configurable: true,
            writable: true
        })
        try {
            return body()
        } finally {
            if (original) {
                Object.defineProperty(globalThis, 'OffscreenCanvas', original)
            }
        }
    }

    /**
     * Regression: a page written entirely on the keyboard has no strokes, so
     * the stroke bounds came back null and the page was reported as a render
     * FAILURE — a wholly typed notebook synced as "N pages failed to render".
     */
    test('a typed-only page renders as a blank standard page, not a failure', async () => {
        const page: Page = {
            pageId: 'p0',
            pageIndex: 0,
            strokes: [],
            text: {
                items: [
                    {
                        itemId: { author: 1, counter: 10 },
                        leftId: { author: 0, counter: 0 },
                        rightId: { author: 0, counter: 0 },
                        deletedLength: 0,
                        text: 'typed on the keyboard'
                    }
                ],
                styles: [],
                x: 0,
                y: 0,
                width: 936
            }
        }

        await withDrawableCanvas(async () => {
            const canvas = await renderPageToCanvas(page)
            expect(canvas).not.toBeNull()
            expect(canvas!.width).toBe(PAGE_WIDTH)
            expect(canvas!.height).toBe(PAGE_HEIGHT)
        })
    })

    test('a genuinely blank page still renders nothing', async () => {
        const page: Page = { pageId: 'p1', pageIndex: 1, strokes: [] }
        await withDrawableCanvas(async () => {
            expect(await renderPageToCanvas(page)).toBeNull()
        })
    })
})

describe('renderPage with captured images', () => {
    test('writes no image when the only capture fails to decode', async () => {
        // Before this check the page produced a white canvas that the pipeline
        // wrote to the vault and counted as a successful sync.
        await withStubbedCanvas({ decode: 'reject' }, async (canvases) => {
            const result = await renderPage(page([], [image()]), 'png')

            expect(result).toBeNull()
            expect(canvases[0]!.ctx.ops).toEqual(['fillRect'])
        })
    })

    test('writes no image on a device that cannot decode images at all', async () => {
        await withStubbedCanvas({ decode: 'absent' }, async () => {
            expect(await renderPage(page([], [image()]), 'png')).toBeNull()
        })
    })

    test('still renders the handwriting when a capture fails to decode', async () => {
        await withStubbedCanvas({ decode: 'reject' }, async (canvases) => {
            const result = await renderPage(page([stroke()], [image()]), 'png')

            expect(result).not.toBeNull()
            expect(canvases[0]!.ctx.ops).toContain('stroke')
        })
    })

    test('draws the capture beneath the handwriting', async () => {
        await withStubbedCanvas({ decode: 'ok' }, async (canvases) => {
            await renderPage(page([stroke()], [image()]), 'png')
            const ops = canvases[0]!.ctx.ops

            expect(ops.indexOf('drawImage')).toBeLessThan(ops.indexOf('stroke'))
        })
    })

    test('keeps the handwriting when a placement rectangle is absurd', async () => {
        // A misparsed vertex buffer yields a huge but finite float32. Sizing
        // the canvas to it either allocates gigabytes or throws, and throwing
        // dropped the page along with handwriting that rendered fine before.
        await withStubbedCanvas({ decode: 'ok', maxArea: 2 ** 27 }, async (canvases) => {
            const absurd = image({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 })
            const result = await renderPage(page([stroke()], [absurd]), 'png')

            expect(result).not.toBeNull()
            expect(canvases[0]!.width * canvases[0]!.height).toBeLessThanOrEqual(2 ** 27)
            expect(canvases[0]!.ctx.ops).toContain('stroke')
        })
    })

    test('a normal capture page still renders at the standard page size', async () => {
        await withStubbedCanvas({ decode: 'ok' }, async (canvases) => {
            await renderPage(page([], [image()]), 'png')

            expect([canvases[0]!.width, canvases[0]!.height]).toEqual([1404, 1872])
        })
    })
})
