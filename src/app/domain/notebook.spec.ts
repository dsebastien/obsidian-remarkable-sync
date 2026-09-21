import { test, expect, describe } from 'bun:test'
import { describeListing, failedListing, notebookDisplayPath } from './notebook'
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

describe('notebookDisplayPath', () => {
    test('prefixes the folder path when there is one', () => {
        expect(notebookDisplayPath({ ...notebook('a'), folderPath: 'Work' })).toBe('Work/a')
    })

    test('returns the bare name at the vault root', () => {
        expect(notebookDisplayPath(notebook('a'))).toBe('a')
    })
})
