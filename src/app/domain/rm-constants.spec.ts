import { test, expect, describe } from 'bun:test'
import {
    RM_HEADER,
    RM_HEADER_LENGTH,
    PAGE_WIDTH,
    PAGE_HEIGHT,
    STROKE_COLOR_MAP,
    PEN_WIDTH_MULTIPLIER,
    HIGHLIGHTER_PEN_TYPES,
    ERASER_PEN_TYPES
} from './rm-constants'

describe('rm-constants', () => {
    test('header starts with expected prefix', () => {
        expect(RM_HEADER).toContain('reMarkable .lines file')
    })

    test('header length is 43 bytes', () => {
        expect(RM_HEADER_LENGTH).toBe(43)
    })

    test('page dimensions match reMarkable spec', () => {
        expect(PAGE_WIDTH).toBe(1404)
        expect(PAGE_HEIGHT).toBe(1872)
    })

    test('stroke color map includes black', () => {
        expect(STROKE_COLOR_MAP[0]).toBe('#000000')
    })

    test('pen width multiplier includes ballpoint', () => {
        expect(PEN_WIDTH_MULTIPLIER[2]).toBe(1.2)
    })

    test('highlighter types include expected pens', () => {
        expect(HIGHLIGHTER_PEN_TYPES.has(5)).toBe(true)
        expect(HIGHLIGHTER_PEN_TYPES.has(18)).toBe(true)
    })

    test('eraser types include expected pens', () => {
        expect(ERASER_PEN_TYPES.has(6)).toBe(true)
        expect(ERASER_PEN_TYPES.has(8)).toBe(true)
    })
})
