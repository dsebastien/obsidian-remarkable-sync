import { test, expect, describe } from 'bun:test'
import { deriveSyncStatus, findOrphanedSyncIds, DEFAULT_SYNC_STORE } from './sync-state'
import type { NotebookSyncState, SyncStore } from './sync-state'

describe('deriveSyncStatus', () => {
    test('returns never-synced when state is undefined', () => {
        expect(deriveSyncStatus(undefined)).toBe('never-synced')
    })

    test('returns never-synced when lastSyncedAt is 0', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 0,
            lastModifiedCloud: 1000,
            syncedPageCount: 0
        }
        expect(deriveSyncStatus(state)).toBe('never-synced')
    })

    test('returns synced when lastSyncedAt >= lastModifiedCloud', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 2000,
            lastModifiedCloud: 1000,
            syncedPageCount: 5
        }
        expect(deriveSyncStatus(state)).toBe('synced')
    })

    test('returns synced when lastSyncedAt equals lastModifiedCloud', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 1000,
            lastModifiedCloud: 1000,
            syncedPageCount: 5
        }
        expect(deriveSyncStatus(state)).toBe('synced')
    })

    test('returns needs-sync when lastSyncedAt < lastModifiedCloud', () => {
        const state: NotebookSyncState = {
            remarkableId: 'test-id',
            lastSyncedAt: 500,
            lastModifiedCloud: 1000,
            syncedPageCount: 5
        }
        expect(deriveSyncStatus(state)).toBe('needs-sync')
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
        expect(findOrphanedSyncIds(store, new Set())).toEqual(['a', 'b', 'c'])
    })
})

describe('DEFAULT_SYNC_STORE', () => {
    test('has empty notebooks record', () => {
        expect(DEFAULT_SYNC_STORE.notebooks).toEqual({})
    })
})
