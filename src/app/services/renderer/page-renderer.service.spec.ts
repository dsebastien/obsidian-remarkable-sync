import { test, expect, describe } from 'bun:test'
import {
    PAGE_RENDERING_UNSUPPORTED_MESSAGE,
    isPageRenderingSupported,
    renderPageToCanvas
} from './page-renderer.service'
import { PAGE_WIDTH, PAGE_HEIGHT } from '../../domain/rm-constants'
import type { Page } from '../../domain/notebook'

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
    test('a typed-only page renders as a blank standard page, not a failure', () => {
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

        withDrawableCanvas(() => {
            const canvas = renderPageToCanvas(page)
            expect(canvas).not.toBeNull()
            expect(canvas!.width).toBe(PAGE_WIDTH)
            expect(canvas!.height).toBe(PAGE_HEIGHT)
        })
    })

    test('a genuinely blank page still renders nothing', () => {
        const page: Page = { pageId: 'p1', pageIndex: 1, strokes: [] }
        withDrawableCanvas(() => {
            expect(renderPageToCanvas(page)).toBeNull()
        })
    })
})
