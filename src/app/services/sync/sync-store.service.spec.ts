import { test, expect, describe } from 'bun:test'
import { produce } from 'immer'
import type { WritableDraft } from 'immer'
import { createSyncStoreService } from './sync-store.service'
import type { RemarkableSyncPlugin } from '../../plugin'
import { DEFAULT_SETTINGS } from '../../types/plugin-settings.intf'
import type { PluginSettings } from '../../types/plugin-settings.intf'
import type { NotebookSyncState } from '../../domain/sync-state'

function syncState(id: string): NotebookSyncState {
    return {
        remarkableId: id,
        lastSyncedAt: 1000,
        lastModifiedCloud: 1000,
        syncedPageCount: 1
    }
}

interface FakePlugin {
    settings: PluginSettings
    updateSettings(recipe: (draft: WritableDraft<PluginSettings>) => void): Promise<void>
}

function createFakePlugin(notebooks: Record<string, NotebookSyncState>): FakePlugin {
    const fake: FakePlugin = {
        settings: produce(DEFAULT_SETTINGS, (draft: WritableDraft<PluginSettings>) => {
            draft.syncStore = { notebooks }
        }),
        updateSettings: (recipe: (draft: WritableDraft<PluginSettings>) => void): Promise<void> => {
            fake.settings = produce(fake.settings, recipe)
            return Promise.resolve()
        }
    }
    return fake
}

function serviceFor(fake: FakePlugin): ReturnType<typeof createSyncStoreService> {
    return createSyncStoreService(fake as unknown as RemarkableSyncPlugin)
}

describe('pruneMissing', () => {
    test('removes entries absent from the cloud listing and returns the count', async () => {
        const fake = createFakePlugin({ a: syncState('a'), b: syncState('b'), c: syncState('c') })
        const service = serviceFor(fake)

        const pruned = await service.pruneMissing(['a'])

        expect(pruned).toBe(2)
        expect(Object.keys(fake.settings.syncStore.notebooks)).toEqual(['a'])
    })

    test('keeps every entry when all are present', async () => {
        const fake = createFakePlugin({ a: syncState('a'), b: syncState('b') })
        const service = serviceFor(fake)

        const pruned = await service.pruneMissing(['a', 'b', 'extra-cloud-only'])

        expect(pruned).toBe(0)
        expect(Object.keys(fake.settings.syncStore.notebooks)).toEqual(['a', 'b'])
    })

    test('does not persist settings when nothing is orphaned', async () => {
        const fake = createFakePlugin({ a: syncState('a') })
        const service = serviceFor(fake)
        const settingsBefore = fake.settings

        await service.pruneMissing(['a'])

        expect(fake.settings).toBe(settingsBefore)
    })

    test('prunes everything when the listing is empty', async () => {
        const fake = createFakePlugin({ a: syncState('a'), b: syncState('b') })
        const service = serviceFor(fake)

        const pruned = await service.pruneMissing([])

        expect(pruned).toBe(2)
        expect(fake.settings.syncStore.notebooks).toEqual({})
    })
})

describe('updateState / getState / clearAll', () => {
    test('updateState stores state retrievable via getState', async () => {
        const fake = createFakePlugin({})
        const service = serviceFor(fake)

        await service.updateState('a', 5000, 3)

        const state = service.getState('a')
        expect(state?.remarkableId).toBe('a')
        expect(state?.lastModifiedCloud).toBe(5000)
        expect(state?.syncedPageCount).toBe(3)
    })

    test('clearAll empties the store', async () => {
        const fake = createFakePlugin({ a: syncState('a') })
        const service = serviceFor(fake)

        await service.clearAll()

        expect(fake.settings.syncStore.notebooks).toEqual({})
    })
})
