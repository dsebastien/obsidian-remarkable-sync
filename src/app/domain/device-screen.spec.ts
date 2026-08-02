import { test, expect, describe } from 'bun:test'
import {
    DEVICE_SCREENS,
    DEFAULT_DEVICE_SCREEN,
    deviceScreenFor,
    deviceDpi,
    pointsPerRmUnit
} from './device-screen'

describe('DEVICE_SCREENS', () => {
    test('covers the five models across three screens', () => {
        expect(DEVICE_SCREENS).toHaveLength(3)
        const models = DEVICE_SCREENS.map((s) => s.models).join(', ')
        for (const m of [
            'reMarkable 1',
            'reMarkable 2',
            'Paper Pure',
            'Paper Pro',
            'Paper Pro Move'
        ])
            expect(models).toContain(m)
    })

    test('no two screens share a resolution, since resolution is the lookup key', () => {
        const keys = DEVICE_SCREENS.map((s) => `${s.widthPx}x${s.heightPx}`)
        expect(new Set(keys).size).toBe(keys.length)
    })

    test('every screen is portrait and physically plausible', () => {
        for (const s of DEVICE_SCREENS) {
            expect(s.heightPx).toBeGreaterThan(s.widthPx)
            expect(s.heightMm).toBeGreaterThan(s.widthMm)
            // e-ink panels in this range are all around 220-270 dpi
            expect(deviceDpi(s)).toBeGreaterThan(200)
            expect(deviceDpi(s)).toBeLessThan(300)
        }
    })

    test('pixel and physical aspect ratios agree, so pixels are square', () => {
        for (const s of DEVICE_SCREENS) {
            const px = s.widthPx / s.heightPx
            const mm = s.widthMm / s.heightMm
            expect(Math.abs(px - mm) / mm).toBeLessThan(0.03)
        }
    })
})

describe('deviceScreenFor', () => {
    test('recognises each screen by its resolution', () => {
        expect(deviceScreenFor(1404, 1872).models).toContain('reMarkable 2')
        expect(deviceScreenFor(1620, 2160).models).toBe('Paper Pro')
        expect(deviceScreenFor(954, 1696).models).toBe('Paper Pro Move')
    })

    /**
     * A document that does not record its screen still has to render. The
     * 1404x1872 panel covers three of the five models and everything sold
     * before the Paper Pro, so it is the least bad guess.
     */
    test('falls back to the default when the document says nothing', () => {
        expect(deviceScreenFor(undefined, undefined)).toBe(DEFAULT_DEVICE_SCREEN)
        expect(deviceScreenFor(0, 0)).toBe(DEFAULT_DEVICE_SCREEN)
        expect(deviceScreenFor(1404, undefined)).toBe(DEFAULT_DEVICE_SCREEN)
    })

    test('an unknown resolution falls back rather than throwing', () => {
        expect(deviceScreenFor(2000, 3000)).toBe(DEFAULT_DEVICE_SCREEN)
    })
})

describe('pointsPerRmUnit', () => {
    /**
     * Measured from the reMarkable 2's own thumbnail render of the sample:
     * 0.317147 pt per unit across a text-highlight rectangle and 0.317162 from
     * the gap between two of them.
     */
    test('the 1404x1872 screen matches what was measured on the device', () => {
        const rm2 = deviceScreenFor(1404, 1872)
        expect(pointsPerRmUnit(rm2)).toBeCloseTo(0.31698, 5)
        expect(deviceDpi(rm2)).toBeCloseTo(227.14, 2)
    })

    test('a denser screen gives a smaller point per unit', () => {
        const rm2 = deviceScreenFor(1404, 1872)
        const move = deviceScreenFor(954, 1696)
        expect(deviceDpi(move)).toBeGreaterThan(deviceDpi(rm2))
        expect(pointsPerRmUnit(move)).toBeLessThan(pointsPerRmUnit(rm2))
    })

    /**
     * The reason this is per device at all. Placing a Paper Pro Move document
     * with the default screen would be out by about 15%, which is a whole line
     * of text a third of the way down a page.
     */
    test('the models differ enough to matter', () => {
        const dflt = pointsPerRmUnit(DEFAULT_DEVICE_SCREEN)
        const pro = pointsPerRmUnit(deviceScreenFor(1620, 2160))
        const move = pointsPerRmUnit(deviceScreenFor(954, 1696))
        expect(Math.abs(pro / dflt - 1)).toBeLessThan(0.01) // under 1%
        expect(Math.abs(move / dflt - 1)).toBeGreaterThan(0.1) // over 10%
    })

    test('a US Letter page is about 1931 units wide on a reMarkable 2', () => {
        expect(612 / pointsPerRmUnit(deviceScreenFor(1404, 1872))).toBeCloseTo(1931, 0)
    })
})
