import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractRmdocFiles } from './rmdoc-import.service'

/**
 * Written by Python's `zipfile`, not by the same library that reads it — so
 * this exercises the unzip path against an independent zip implementation,
 * with a mix of deflated and stored entries plus an explicit directory entry
 * (all shapes a real .rmdoc can contain).
 */
const FIXTURE = join(import.meta.dir, '__fixtures__', 'sample.rmdoc')

function readFixture(): ArrayBuffer {
    const contents = readFileSync(FIXTURE)
    return contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength)
}

function loadFixture(): Map<string, ArrayBuffer> {
    return extractRmdocFiles(readFixture())
}

function decode(files: Map<string, ArrayBuffer>, path: string): string {
    const data = files.get(path)
    if (!data) {
        throw new Error(`missing entry: ${path}`)
    }
    return new TextDecoder().decode(new Uint8Array(data))
}

describe('extractRmdocFiles', () => {
    test('returns every file entry', () => {
        const files = loadFixture()
        expect([...files.keys()].sort()).toEqual([
            'abc123.content',
            'abc123.metadata',
            'abc123/p1.rm',
            'abc123/p2.rm'
        ])
    })

    test('skips directory entries', () => {
        const files = loadFixture()
        expect(files.has('abc123/')).toBe(false)
    })

    test('inflates deflated entries', () => {
        const files = loadFixture()
        expect(JSON.parse(decode(files, 'abc123.metadata'))).toEqual({
            visibleName: 'My Notebook',
            type: 'DocumentType'
        })

        // Binary, deflated.
        const p1 = new Uint8Array(files.get('abc123/p1.rm') ?? new ArrayBuffer(0))
        expect(p1.length).toBe(1024)
        expect([...p1.slice(0, 5)]).toEqual([0, 7, 14, 21, 28])
    })

    test('reads stored (uncompressed) entries', () => {
        const files = loadFixture()
        const p2 = new Uint8Array(files.get('abc123/p2.rm') ?? new ArrayBuffer(0))
        expect(p2.length).toBe(512)
        expect([...p2.slice(0, 5)]).toEqual([5, 18, 31, 44, 57])
    })

    test('each entry is a standalone buffer, not a view into a shared one', () => {
        // fflate hands back views over one backing buffer; callers treat these
        // as independent ArrayBuffers, so a stale view would leak data across
        // pages.
        const files = loadFixture()
        for (const [path, buffer] of files) {
            const expected = 'abc123/p1.rm' === path ? 1024 : 'abc123/p2.rm' === path ? 512 : null
            if (null !== expected) {
                expect(buffer.byteLength).toBe(expected)
            }
        }
    })

    test('throws on data that is not a zip archive', () => {
        const notAZip = new TextEncoder().encode('this is not a zip file at all')
        expect(() => extractRmdocFiles(notAZip.buffer)).toThrow()
    })

    test('throws on a truncated archive', () => {
        expect(() => extractRmdocFiles(readFixture().slice(0, 40))).toThrow()
    })
})
