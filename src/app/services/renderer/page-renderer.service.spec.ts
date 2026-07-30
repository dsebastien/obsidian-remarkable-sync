import { test, expect, describe } from 'bun:test'
import {
    PAGE_RENDERING_UNSUPPORTED_MESSAGE,
    isPageRenderingSupported
} from './page-renderer.service'

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
