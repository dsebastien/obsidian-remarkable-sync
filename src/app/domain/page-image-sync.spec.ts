import { test, expect, describe } from 'bun:test'
import {
    shouldWritePageImage,
    pageImageState,
    nonOcrPageState,
    isPageOcrCurrent
} from './page-image-sync'
import type { PageOcrState } from './sync-state'

const PREV: PageOcrState = {
    pageId: 'p1',
    srcHash: 'aaa',
    ocrHash: 'bbb',
    imgHash: 'aaa',
    pageIndex: 3
}
const PREV_NO_OCR: PageOcrState = {
    pageId: 'p1',
    srcHash: 'aaa',
    ocrHash: '',
    imgHash: 'aaa',
    pageIndex: 3
}
/** Entry persisted before per-page image tracking existed (no imgHash/pageIndex). */
const PREV_LEGACY: PageOcrState = { pageId: 'p1', srcHash: 'aaa', ocrHash: 'bbb' }
/** Entry whose srcHash advanced during a "save images" off sync (file still old). */
const PREV_STALE_FILE: PageOcrState = {
    pageId: 'p1',
    srcHash: 'aaa',
    ocrHash: '',
    imgHash: 'old',
    pageIndex: 3
}

describe('shouldWritePageImage', () => {
    test('writes when the page has no prior state', () => {
        expect(shouldWritePageImage(undefined, 'aaa', 3, true)).toBe(true)
    })

    test('writes when the rendered image hash changed', () => {
        expect(shouldWritePageImage(PREV, 'zzz', 3, true)).toBe(true)
    })

    test('skips when hash and index are unchanged and the file exists', () => {
        expect(shouldWritePageImage(PREV, 'aaa', 3, true)).toBe(false)
    })

    test('writes when the file is missing (user deleted it)', () => {
        expect(shouldWritePageImage(PREV, 'aaa', 3, false)).toBe(true)
    })

    test('writes when the page index shifted (device insert/delete/reorder), even if a file exists at the new path', () => {
        // The file at the new index belongs to a DIFFERENT page; hash equality
        // alone would wrongly keep it.
        expect(shouldWritePageImage(PREV, 'aaa', 2, true)).toBe(true)
    })

    test('writes for a legacy entry without image facts (one-time rewrite)', () => {
        expect(shouldWritePageImage(PREV_LEGACY, 'aaa', 3, true)).toBe(true)
    })

    test('writes when srcHash advanced without a write (save-images-off sync): imgHash is stale', () => {
        expect(shouldWritePageImage(PREV_STALE_FILE, 'aaa', 3, true)).toBe(true)
    })

    test('skips based on image facts even when the page was never OCRd', () => {
        expect(shouldWritePageImage(PREV_NO_OCR, 'aaa', 3, true)).toBe(false)
    })
})

describe('pageImageState', () => {
    test('after a write, records the written hash and index', () => {
        expect(pageImageState(PREV, 'zzz', 4, true)).toEqual({ imgHash: 'zzz', pageIndex: 4 })
    })

    test('without a write, carries the prior file facts forward', () => {
        expect(pageImageState(PREV_STALE_FILE, 'zzz', 4, false)).toEqual({
            imgHash: 'old',
            pageIndex: 3
        })
    })

    test('without a write and no prior state, records nothing', () => {
        expect(pageImageState(undefined, 'zzz', 4, false)).toEqual({
            imgHash: undefined,
            pageIndex: undefined
        })
    })
})

describe('nonOcrPageState', () => {
    test('new page → entry with srcHash, empty ocrHash, and the given image facts', () => {
        expect(nonOcrPageState('p2', 'ccc', undefined, { imgHash: 'ccc', pageIndex: 0 })).toEqual({
            pageId: 'p2',
            srcHash: 'ccc',
            ocrHash: '',
            imgHash: 'ccc',
            pageIndex: 0
        })
    })

    test('unchanged page → prior ocrHash (OCR progress) preserved', () => {
        expect(nonOcrPageState('p1', 'aaa', PREV, { imgHash: 'aaa', pageIndex: 3 })).toEqual({
            pageId: 'p1',
            srcHash: 'aaa',
            ocrHash: 'bbb',
            imgHash: 'aaa',
            pageIndex: 3
        })
    })

    test('changed page → new srcHash, stale ocrHash dropped so OCR re-runs later', () => {
        expect(nonOcrPageState('p1', 'zzz', PREV, { imgHash: 'zzz', pageIndex: 3 })).toEqual({
            pageId: 'p1',
            srcHash: 'zzz',
            ocrHash: '',
            imgHash: 'zzz',
            pageIndex: 3
        })
    })
})

describe('isPageOcrCurrent', () => {
    test('current when unchanged and previously OCRd', () => {
        expect(isPageOcrCurrent(PREV, 'aaa')).toBe(true)
    })

    test('not current without prior state', () => {
        expect(isPageOcrCurrent(undefined, 'aaa')).toBe(false)
    })

    test('not current when the image changed', () => {
        expect(isPageOcrCurrent(PREV, 'zzz')).toBe(false)
    })

    test('not current when the entry came from a non-OCR sync (empty ocrHash)', () => {
        expect(isPageOcrCurrent(PREV_NO_OCR, 'aaa')).toBe(false)
    })
})
