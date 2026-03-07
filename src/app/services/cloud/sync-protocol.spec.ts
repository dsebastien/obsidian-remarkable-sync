import { test, expect, describe } from 'bun:test'
import { parseIndex } from './sync-protocol'

describe('sync-protocol', () => {
    describe('parseIndex', () => {
        test('parses entries with header lines', () => {
            const index = '3\n2\nabc123:80000000:folder-id-1:0:0\ndef456:0:doc-id-1:0:512\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(2)
            expect(entries[0]!.hash).toBe('abc123')
            expect(entries[0]!.type).toBe('80000000')
            expect(entries[0]!.id).toBe('folder-id-1')
            expect(entries[0]!.subfiles).toBe(0)
            expect(entries[0]!.size).toBe(0)
            expect(entries[1]!.hash).toBe('def456')
            expect(entries[1]!.type).toBe('0')
            expect(entries[1]!.id).toBe('doc-id-1')
            expect(entries[1]!.size).toBe(512)
        })

        test('parses legacy format without header lines', () => {
            const index = 'abc123:80000000:folder-id-1\ndef456:0:doc-id-1\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(2)
            expect(entries[0]!.hash).toBe('abc123')
            expect(entries[0]!.type).toBe('80000000')
            expect(entries[0]!.id).toBe('folder-id-1')
            expect(entries[1]!.type).toBe('0')
            expect(entries[1]!.id).toBe('doc-id-1')
        })

        test('handles empty input', () => {
            const entries = parseIndex('')
            expect(entries.length).toBe(0)
        })

        test('skips malformed lines', () => {
            const index = '3\n3\nabc123:80000000:folder-id:0:0\nbadline\nghi789:0:doc-id:0:0\n'
            const entries = parseIndex(index)
            expect(entries.length).toBe(2)
        })

        test('parses document index entries with file paths', () => {
            const index =
                '3\n3\nabc:0:docid.metadata:0:100\ndef:0:docid.content:0:200\nghi:0:docid/page1.rm:0:500\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(3)
            expect(entries[0]!.id).toBe('docid.metadata')
            expect(entries[1]!.id).toBe('docid.content')
            expect(entries[2]!.id).toBe('docid/page1.rm')
        })
    })
})
