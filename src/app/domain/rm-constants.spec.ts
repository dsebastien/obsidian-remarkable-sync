import { test, expect, describe } from 'bun:test'
import { STROKE_COLOR_MAP } from './rm-constants'

describe('STROKE_COLOR_MAP', () => {
    /**
     * The renderer falls back to black for any unmapped colour. Colour 9 is the
     * v2 highlighter's own colour, so leaving it unmapped painted a wide opaque
     * black bar over the writing it was highlighting. Found on a real device
     * export. rmscene's PenColor enum defines 0 to 13.
     */
    test('covers the full 0-13 range that firmware can emit', () => {
        for (let colour = 0; colour <= 13; colour++) {
            expect(
                STROKE_COLOR_MAP[colour],
                `colour ${colour} is unmapped and renders as black`
            ).toBeDefined()
        }
    })

    test('every entry is a hex colour', () => {
        for (const [key, value] of Object.entries(STROKE_COLOR_MAP)) {
            expect(value, `colour ${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
        }
    })

    test('the highlighter colour is not black', () => {
        // The whole point: a highlighter must never render as an opaque black bar.
        expect(STROKE_COLOR_MAP[9]).not.toBe('#000000')
    })

    test('the original nine colours are unchanged', () => {
        expect(STROKE_COLOR_MAP[0]).toBe('#000000')
        expect(STROKE_COLOR_MAP[3]).toBe('#FFFF00')
        expect(STROKE_COLOR_MAP[7]).toBe('#FF0000')
        expect(STROKE_COLOR_MAP[8]).toBe('#C0C0C0')
    })
})
