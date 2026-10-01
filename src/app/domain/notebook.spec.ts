import { test, expect, describe } from 'bun:test'
import {
    currentSyncTarget,
    describeListing,
    failedListing,
    mergeListing,
    notebookDisplayPath,
    syncCandidates,
    syncIdsToKeep
} from './notebook'
import type { NotebookSummary } from './notebook'

function notebook(id: string): NotebookSummary {
    return {
        id,
        visibleName: id,
        parent: '',
        lastModified: '1000',
        pageCount: 1,
        folderPath: ''
    }
}

describe('describeListing', () => {
    test('a listing with nothing unreadable is complete', () => {
        const listing = describeListing([notebook('a'), notebook('b')], 0)

        expect(listing.complete).toBe(true)
        expect(listing.error).toBeNull()
        expect(listing.notebooks).toHaveLength(2)
    })

    test('an empty listing with nothing unreadable is still complete', () => {
        // A genuinely empty account. This is the ONLY case where an empty list
        // is allowed to authorise pruning, and it has to stay distinguishable
        // from the failure below.
        const listing = describeListing([], 0)

        expect(listing.complete).toBe(true)
        expect(listing.error).toBeNull()
    })

    test('one unreadable entry makes the whole listing incomplete', () => {
        // One document's metadata failing is not evidence that any other
        // notebook was deleted, so nothing may be pruned from this.
        const listing = describeListing([notebook('a')], 1)

        expect(listing.complete).toBe(false)
        expect(listing.error).toContain('1 item(s)')
    })

    test('an incomplete listing still carries what it did read', () => {
        // Degraded, not broken: the notebooks that were read stay usable for
        // display and for syncing.
        const listing = describeListing([notebook('a'), notebook('b')], 3)

        expect(listing.notebooks.map((nb) => nb.id)).toEqual(['a', 'b'])
    })
})

describe('failedListing', () => {
    test('is not complete even though it holds no notebooks', () => {
        // The distinction this whole type exists for. Returning a bare `[]`
        // here is what let pruning read "the cloud is unreachable" as "every
        // notebook was deleted" and erase the sync store, from 1.10.0 until
        // 2.1.0.
        const listing = failedListing('Could not reach the reMarkable cloud')

        expect(listing.notebooks).toEqual([])
        expect(listing.complete).toBe(false)
        expect(listing.error).toBe('Could not reach the reMarkable cloud')
    })

    test('is distinguishable from a genuinely empty account', () => {
        expect(failedListing('offline').complete).toBe(false)
        expect(describeListing([], 0).complete).toBe(true)
    })
})

describe('syncIdsToKeep', () => {
    test('a complete listing keeps exactly what it listed', () => {
        expect(syncIdsToKeep(describeListing([notebook('a'), notebook('b')], 0))).toEqual([
            'a',
            'b'
        ])
        // A genuinely empty account prunes everything.
        expect(syncIdsToKeep(describeListing([], 0))).toEqual([])
    })

    test('a partial listing keeps what it listed and what it could not read', () => {
        // A notebook the cloud never serves must not block pruning forever,
        // nor be pruned itself: it is still in the index.
        const listing = describeListing([notebook('a')], 1, ['broken'])
        expect(syncIdsToKeep(listing)).toEqual(['a', 'broken'])
    })

    test('a listing that cannot name its unreadable entries prunes nothing', () => {
        // Rejected index lines: an absent id may be one of them.
        expect(syncIdsToKeep(describeListing([notebook('a')], 1, null))).toBeNull()
        // The cloud was unreachable: nothing was named at all.
        expect(syncIdsToKeep(failedListing('offline'))).toBeNull()
    })
})

describe('notebookDisplayPath', () => {
    test('prefixes the folder path when there is one', () => {
        expect(notebookDisplayPath({ ...notebook('a'), folderPath: 'Work' })).toBe('Work/a')
    })

    test('returns the bare name at the vault root', () => {
        expect(notebookDisplayPath(notebook('a'))).toBe('a')
    })
})

describe('mergeListing', () => {
    const nb = (id: string): NotebookSummary => ({
        id,
        visibleName: id,
        parent: '',
        lastModified: '1',
        pageCount: 0,
        folderPath: ''
    })
    const ids = (list: NotebookSummary[]): string[] => list.map((n) => n.id)

    test('a complete listing replaces the previous list; nothing is stale', () => {
        const merged = mergeListing([nb('a'), nb('gone')], describeListing([nb('a'), nb('b')], 0))
        expect(merged.outcome).toBe('complete')
        expect(ids(merged.notebooks)).toEqual(['a', 'b'])
        expect([...merged.staleIds]).toEqual([])
    })

    test('a partial listing keeps only the unreadable ones, marked stale', () => {
        const merged = mergeListing(
            [nb('a'), nb('held'), nb('deleted')],
            describeListing([nb('a'), nb('b')], 1, ['held'])
        )
        expect(merged.outcome).toBe('partial')
        expect(ids(merged.notebooks)).toEqual(['a', 'b', 'held'])
        expect([...merged.staleIds]).toEqual(['held'])
    })

    test('a partial listing with unknown unreadable ids keeps every absent entry, stale', () => {
        const merged = mergeListing(
            [nb('a'), nb('x'), nb('y')],
            describeListing([nb('a')], 1, null)
        )
        expect(ids(merged.notebooks)).toEqual(['a', 'x', 'y'])
        expect([...merged.staleIds].sort()).toEqual(['x', 'y'])
    })

    test('a failed listing keeps the previous list, all stale', () => {
        const merged = mergeListing([nb('a')], failedListing('offline'))
        expect(merged.outcome).toBe('failed')
        expect(ids(merged.notebooks)).toEqual(['a'])
        expect([...merged.staleIds]).toEqual(['a'])
    })

    test('describeListing carries the unreadable ids; a complete one has none', () => {
        expect(describeListing([nb('a')], 1, ['b']).unreadableIds).toEqual(['b'])
        expect(describeListing([nb('a')], 0).unreadableIds).toEqual([])
        expect(failedListing('x').unreadableIds).toBeNull()
    })
})

describe('sync candidates', () => {
    const nb = (id: string, folderPath = ''): NotebookSummary => ({
        id,
        visibleName: id,
        parent: '',
        lastModified: '1',
        pageCount: 0,
        folderPath
    })

    test('never a stale entry; only what include accepts; ids in list order', () => {
        const list = [nb('a'), nb('stale'), nb('b'), nb('skip')]
        expect(syncCandidates(list, new Set(['stale']), (n) => n.id !== 'skip')).toEqual(['a', 'b'])
    })

    test('the current entry is synced, not the one captured earlier', () => {
        const moved = [nb('a', 'B')]
        expect(currentSyncTarget(moved, new Set(), 'a')?.folderPath).toBe('B')
    })

    test('nothing to sync when the entry is gone or stale', () => {
        expect(currentSyncTarget([nb('b')], new Set(), 'a')).toBeNull()
        expect(currentSyncTarget([nb('a')], new Set(['a']), 'a')).toBeNull()
    })
})
