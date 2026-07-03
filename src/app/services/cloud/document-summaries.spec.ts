import { test, expect, describe } from 'bun:test'
import { buildNotebookSummaries } from './document-summaries'
import type { EntryMetadata } from './document-summaries'
import type { RemarkableDocumentMetadata } from '../../domain/remarkable-types'

function meta(overrides: Partial<RemarkableDocumentMetadata>): RemarkableDocumentMetadata {
    return {
        deleted: false,
        lastModified: '0',
        lastOpened: '0',
        lastOpenedPage: 0,
        metadatamodified: false,
        modified: false,
        parent: '',
        pinned: false,
        synced: true,
        type: 'DocumentType',
        version: 1,
        visibleName: 'Doc',
        ...overrides
    }
}

function entry(id: string, overrides: Partial<RemarkableDocumentMetadata>): EntryMetadata {
    return { id, metadata: meta(overrides) }
}

describe('buildNotebookSummaries', () => {
    test('carries pinned through to the summary', () => {
        const result = buildNotebookSummaries([
            entry('starred', { visibleName: 'Starred', pinned: true }),
            entry('plain', { visibleName: 'Plain', pinned: false })
        ])
        expect(result.find((n) => n.id === 'starred')?.pinned).toBe(true)
        expect(result.find((n) => n.id === 'plain')?.pinned).toBe(false)
    })

    test('missing pinned field (older/self-hosted clouds) → false', () => {
        const noPinned = entry('legacy', {})
        // Simulate metadata JSON without the field
        const { pinned: _pinned, ...rest } = noPinned.metadata
        const result = buildNotebookSummaries([
            { id: 'legacy', metadata: rest as RemarkableDocumentMetadata }
        ])
        expect(result[0]?.pinned).toBe(false)
    })

    test('resolves folder path from the parent chain', () => {
        const result = buildNotebookSummaries([
            entry('f-2026', { type: 'CollectionType', visibleName: '2026' }),
            entry('f-sub', { type: 'CollectionType', visibleName: 'Sub', parent: 'f-2026' }),
            entry('doc', { visibleName: 'Journal', parent: 'f-sub' })
        ])
        expect(result.map((n) => n.id)).toEqual(['doc'])
        expect(result[0]?.folderPath).toBe('2026/Sub')
    })

    test('skips deleted and trashed entries', () => {
        const result = buildNotebookSummaries([
            entry('gone', { deleted: true }),
            entry('trashed', { parent: 'trash' }),
            entry('kept', { visibleName: 'Kept' })
        ])
        expect(result.map((n) => n.id)).toEqual(['kept'])
    })

    test('folders themselves are not summaries', () => {
        const result = buildNotebookSummaries([
            entry('f', { type: 'CollectionType', visibleName: 'Folder' })
        ])
        expect(result).toEqual([])
    })
})
