import { test, expect, describe } from 'bun:test'
import {
    deriveSyncStatus,
    findOrphanedSyncIds,
    parseCloudTimestamp,
    DEFAULT_SYNC_STORE
} from './sync-state'
import type { NotebookSyncState, SyncStore } from './sync-state'

describe('parseCloudTimestamp', () => {
    test('parses a plain epoch-millisecond string', () => {
        expect(parseCloudTimestamp('1756742400000')).toBe(1756742400000)
    })

    test('rejects an ISO-8601 date rather than reading its year', () => {
        // The failure this guards against is silent and total: parseInt would
        // return 2026, which compares as 1970, so every notebook would look
        // permanently up to date and nothing would ever sync again.
        expect(parseCloudTimestamp('2026-09-19T21:55:00Z')).toBeNull()
    })

    test('rejects values that are not plain integers', () => {
        expect(parseCloudTimestamp('')).toBeNull()
        expect(parseCloudTimestamp(undefined)).toBeNull()
        expect(parseCloudTimestamp('abc')).toBeNull()
        expect(parseCloudTimestamp('12.5')).toBeNull()
        expect(parseCloudTimestamp('-1000')).toBeNull()
    })
})

describe('deriveSyncStatus', () => {
    const synced = (lastModifiedCloud: number): NotebookSyncState => ({
        remarkableId: 'test-id',
        lastSyncedAt: 1_700_000_000_000,
        lastModifiedCloud,
        syncedPageCount: 5
    })

    test('returns never-synced when state is undefined', () => {
        expect(deriveSyncStatus(undefined, '1000')).toBe('never-synced')
    })

    test('returns never-synced when lastSyncedAt is 0', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 0,
            lastModifiedCloud: 1000,
            syncedPageCount: 0
        }
        expect(deriveSyncStatus(state, '1000')).toBe('never-synced')
    })

    test('returns synced when the cloud timestamp has not moved', () => {
        expect(deriveSyncStatus(synced(1000), '1000')).toBe('synced')
    })

    test('returns needs-sync when the cloud timestamp has advanced', () => {
        // The case the old rule could never reach. It compared lastSyncedAt
        // against lastModifiedCloud, two values written in the same breath, so
        // a notebook edited on the device stayed "synced" forever.
        expect(deriveSyncStatus(synced(1000), '2000')).toBe('needs-sync')
    })

    test('ignores the local clock entirely', () => {
        // Both sides of the comparison are cloud timestamps, so a local clock
        // that is wrong by years cannot change the answer.
        const skewed: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 1,
            lastModifiedCloud: 1000,
            syncedPageCount: 5
        }
        expect(deriveSyncStatus(skewed, '1000')).toBe('synced')
        expect(deriveSyncStatus(skewed, '1001')).toBe('needs-sync')
    })

    test('leaves a synced notebook alone when the cloud timestamp is unusable', () => {
        // We cannot tell whether it changed. Re-downloading it on every pass
        // forever is the worse of the two failures.
        expect(deriveSyncStatus(synced(1000), 'not-a-timestamp')).toBe('synced')
        expect(deriveSyncStatus(synced(1000), undefined)).toBe('synced')
    })

    test('a notebook synced before its cloud timestamp was readable can resync', () => {
        // The pipeline records 0 for an unparseable timestamp, so any real
        // timestamp later beats it rather than the notebook being stuck.
        expect(deriveSyncStatus(synced(0), '1000')).toBe('needs-sync')
    })
})

describe('findOrphanedSyncIds', () => {
    const state = (id: string): NotebookSyncState => ({
        remarkableId: id,
        lastSyncedAt: 1000,
        lastModifiedCloud: 1000,
        syncedPageCount: 1
    })
    const store: SyncStore = {
        notebooks: { a: state('a'), b: state('b'), c: state('c') }
    }

    test('returns ids missing from the cloud listing', () => {
        expect(findOrphanedSyncIds(store, new Set(['a', 'c']))).toEqual(['b'])
    })

    test('returns empty when all entries are present in the listing', () => {
        expect(findOrphanedSyncIds(store, new Set(['a', 'b', 'c', 'd']))).toEqual([])
    })

    test('returns empty for an empty store', () => {
        expect(findOrphanedSyncIds(DEFAULT_SYNC_STORE, new Set(['a']))).toEqual([])
    })

    test('returns all ids when the listing is empty', () => {
        // Correct for the pure function, and precisely why the CALLER must
        // never hand it the empty list a failed cloud fetch returns. That is
        // what erased the sync store between 1.10.0 and 2.1.0; the guard now
        // lives at both call sites, gated on DocumentListing.complete.
        expect(findOrphanedSyncIds(store, new Set())).toEqual(['a', 'b', 'c'])
    })
})

describe('DEFAULT_SYNC_STORE', () => {
    test('has empty notebooks record', () => {
        expect(DEFAULT_SYNC_STORE.notebooks).toEqual({})
    })
})
