import { test, expect, describe } from 'bun:test'
import { imageAssetMediaType } from './image-utils'

describe('imageAssetMediaType', () => {
    test('names the formats the capture tool can write', () => {
        expect(imageAssetMediaType('a.png')).toBe('image/png')
        expect(imageAssetMediaType('a.jpg')).toBe('image/jpeg')
        expect(imageAssetMediaType('a.jpeg')).toBe('image/jpeg')
        expect(imageAssetMediaType('a.webp')).toBe('image/webp')
    })

    test('is case-insensitive and works on a full path', () => {
        expect(imageAssetMediaType('doc/page/Capture.PNG')).toBe('image/png')
    })

    test('returns null for anything else', () => {
        // Callers treat null as 'no hint'; createImageBitmap sniffs the
        // bytes anyway, so an unknown extension is not a failure.
        expect(imageAssetMediaType('page.rm')).toBeNull()
        expect(imageAssetMediaType('doc.content')).toBeNull()
        expect(imageAssetMediaType('noextension')).toBeNull()
    })
})
