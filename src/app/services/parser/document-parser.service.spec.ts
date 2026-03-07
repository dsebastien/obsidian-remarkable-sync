import { test, expect, describe } from 'bun:test'
import { parseDocument, extractPageOrder } from './document-parser.service'
import { RM_HEADER, RM_HEADER_LENGTH } from '../../domain/rm-constants'
import type { RemarkableDocumentContent } from '../../domain/remarkable-types'

function toBuffer(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer
}

function createRmHeader(): ArrayBuffer {
    const encoder = new TextEncoder()
    const headerBytes = encoder.encode(RM_HEADER)
    const buffer = new ArrayBuffer(RM_HEADER_LENGTH)
    new Uint8Array(buffer).set(headerBytes)
    return buffer
}

const METADATA = JSON.stringify({
    deleted: false,
    lastModified: '1700000000000',
    lastOpened: '1700000000000',
    lastOpenedPage: 0,
    metadatamodified: false,
    modified: true,
    parent: 'parent-folder-id',
    pinned: false,
    synced: true,
    type: 'DocumentType',
    version: 1,
    visibleName: 'Test Notebook'
})

const CONTENT_WITH_PAGES = JSON.stringify({
    dpiScale: 1,
    fileType: 'notebook',
    fontName: '',
    lastOpenedPage: 0,
    lineHeight: -1,
    margins: 100,
    orientation: 'portrait',
    pageCount: 2,
    pages: ['page-aaa-111', 'page-bbb-222'],
    textAlignment: 'left',
    textScale: 1
})

describe('document-parser', () => {
    test('parses document with metadata and content', () => {
        const files = new Map<string, ArrayBuffer>()
        files.set('docid.metadata', toBuffer(METADATA))
        files.set('docid.content', toBuffer(CONTENT_WITH_PAGES))
        files.set('docid/page-aaa-111.rm', createRmHeader())
        files.set('docid/page-bbb-222.rm', createRmHeader())

        const result = parseDocument(files, 'test-doc-id')

        expect(result).not.toBeNull()
        expect(result!.id).toBe('test-doc-id')
        expect(result!.visibleName).toBe('Test Notebook')
        expect(result!.parent).toBe('parent-folder-id')
        expect(result!.lastModified).toBe('1700000000000')
        expect(result!.pageCount).toBe(2)
        expect(result!.pages.length).toBe(2)
        expect(result!.pages[0]!.pageId).toBe('page-aaa-111')
        expect(result!.pages[1]!.pageId).toBe('page-bbb-222')
    })

    test('returns null when no metadata file', () => {
        const files = new Map<string, ArrayBuffer>()
        files.set('docid.content', toBuffer(CONTENT_WITH_PAGES))

        const result = parseDocument(files, 'test-doc-id')

        expect(result).toBeNull()
    })

    test('falls back to .rm file paths when no content file', () => {
        const files = new Map<string, ArrayBuffer>()
        files.set('docid.metadata', toBuffer(METADATA))
        files.set('docid/abc-def-123.rm', createRmHeader())

        const result = parseDocument(files, 'test-doc-id')

        expect(result).not.toBeNull()
        expect(result!.pageCount).toBe(1)
        expect(result!.pages[0]!.pageId).toBe('abc-def-123')
    })

    test('skips pages with no matching .rm file', () => {
        const content = JSON.stringify({
            ...JSON.parse(CONTENT_WITH_PAGES),
            pages: ['page-exists', 'page-missing']
        })

        const files = new Map<string, ArrayBuffer>()
        files.set('docid.metadata', toBuffer(METADATA))
        files.set('docid.content', toBuffer(content))
        files.set('docid/page-exists.rm', createRmHeader())

        const result = parseDocument(files, 'test-doc-id')

        expect(result).not.toBeNull()
        expect(result!.pageCount).toBe(1)
        expect(result!.pages[0]!.pageId).toBe('page-exists')
    })

    test('returns empty pages when no .rm files present', () => {
        const files = new Map<string, ArrayBuffer>()
        files.set('docid.metadata', toBuffer(METADATA))

        const result = parseDocument(files, 'test-doc-id')

        expect(result).not.toBeNull()
        expect(result!.pageCount).toBe(0)
        expect(result!.pages.length).toBe(0)
    })

    test('returns null on empty file map', () => {
        const files = new Map<string, ArrayBuffer>()

        const result = parseDocument(files, 'test-doc-id')

        expect(result).toBeNull()
    })

    test('uses cPages order over flat pages array', () => {
        const content = JSON.stringify({
            ...JSON.parse(CONTENT_WITH_PAGES),
            pages: ['page-aaa-111', 'page-bbb-222'],
            cPages: {
                pages: [
                    { id: 'page-bbb-222', idx: { value: 'ba' } },
                    { id: 'page-aaa-111', idx: { value: 'bb' } }
                ]
            }
        })

        const files = new Map<string, ArrayBuffer>()
        files.set('docid.metadata', toBuffer(METADATA))
        files.set('docid.content', toBuffer(content))
        files.set('docid/page-aaa-111.rm', createRmHeader())
        files.set('docid/page-bbb-222.rm', createRmHeader())

        const result = parseDocument(files, 'test-doc-id')

        expect(result).not.toBeNull()
        expect(result!.pages[0]!.pageId).toBe('page-bbb-222')
        expect(result!.pages[1]!.pageId).toBe('page-aaa-111')
    })
})

describe('extractPageOrder', () => {
    test('returns null for null content', () => {
        expect(extractPageOrder(null)).toBeNull()
    })

    test('returns flat pages array when no cPages', () => {
        const content = JSON.parse(CONTENT_WITH_PAGES) as RemarkableDocumentContent
        const result = extractPageOrder(content)
        expect(result).toEqual(['page-aaa-111', 'page-bbb-222'])
    })

    test('prefers cPages sorted by idx.value', () => {
        const content = {
            ...JSON.parse(CONTENT_WITH_PAGES),
            cPages: {
                pages: [
                    { id: 'page-c', idx: { value: 'bc' } },
                    { id: 'page-a', idx: { value: 'ba' } },
                    { id: 'page-b', idx: { value: 'bb' } }
                ]
            }
        } as RemarkableDocumentContent

        const result = extractPageOrder(content)
        expect(result).toEqual(['page-a', 'page-b', 'page-c'])
    })

    test('falls back to pages when cPages is empty', () => {
        const content = {
            ...JSON.parse(CONTENT_WITH_PAGES),
            cPages: { pages: [] }
        } as RemarkableDocumentContent

        const result = extractPageOrder(content)
        expect(result).toEqual(['page-aaa-111', 'page-bbb-222'])
    })

    test('returns null when both pages and cPages are empty', () => {
        const content = {
            ...JSON.parse(CONTENT_WITH_PAGES),
            pages: [],
            cPages: { pages: [] }
        } as RemarkableDocumentContent

        const result = extractPageOrder(content)
        expect(result).toBeNull()
    })
})
