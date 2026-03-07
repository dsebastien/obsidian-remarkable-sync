import { test, expect, describe } from 'bun:test'
import { deriveSyncStatus, DEFAULT_SYNC_STORE } from './sync-state'
import type { NotebookSyncState } from './sync-state'

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

describe('DEFAULT_SYNC_STORE', () => {
    test('has empty notebooks record', () => {
        expect(DEFAULT_SYNC_STORE.notebooks).toEqual({})
    })
})
