import { test, expect, describe } from 'bun:test'
import { createRemarkableAuthService } from './remarkable-auth.service'
import type { StoredTokens, TokenStore } from './token-store'
import type { RemarkableSyncPlugin } from '../../plugin'
import { DEFAULT_SETTINGS } from '../../types/plugin-settings.intf'

/**
 * Only the settings are read by the auth service; everything else it needs is
 * injected.
 */
function createFakePlugin(): RemarkableSyncPlugin {
    return { settings: { ...DEFAULT_SETTINGS } } as unknown as RemarkableSyncPlugin
}

interface FakeStore extends TokenStore {
    writes: StoredTokens[]
    clears: number
}

function createFakeStore(tokens: StoredTokens | null, onRead?: () => Promise<void>): FakeStore {
    let current = tokens
    const store: FakeStore = {
        writes: [],
        clears: 0,
        read: async () => {
            if (onRead) {
                await onRead()
            }
            return current
        },
        write: async (value) => {
            store.writes.push(value)
            current = value
            await Promise.resolve()
        },
        clear: async () => {
            store.clears++
            current = null
            await Promise.resolve()
        },
        hasValid: async () => Promise.resolve(null !== current)
    }
    return store
}

describe('createRemarkableAuthService', () => {
    const validTokens: StoredTokens = {
        deviceToken: 'device-abc',
        userToken: 'user-xyz',
        // Far future, so no network refresh is attempted.
        userTokenExpiry: Date.now() + 60 * 60 * 1000
    }

    test('returns the stored user token while it is still valid', async () => {
        const service = createRemarkableAuthService(
            createFakePlugin(),
            createFakeStore(validTokens)
        )
        expect(await service.getUserToken()).toBe('user-xyz')
    })

    test('returns null once disconnected', async () => {
        const store = createFakeStore(validTokens)
        const service = createRemarkableAuthService(createFakePlugin(), store)

        await service.disconnect()

        expect(await service.getUserToken()).toBeNull()
        expect(store.clears).toBe(1)
    })

    test('a disconnect during the store read wins over the in-flight read', async () => {
        // The race this guards: getUserToken captures its generation on entry,
        // and a disconnect landing while the store read is in flight must not
        // be undone by the value that read returns.
        let releaseRead: (() => void) | undefined
        const readBlocked = new Promise<void>((resolve) => {
            releaseRead = resolve
        })
        const store = createFakeStore(validTokens, () => readBlocked)
        const service = createRemarkableAuthService(createFakePlugin(), store)

        const pending = service.getUserToken()
        await service.disconnect()
        releaseRead?.()

        expect(await pending).toBeNull()
    })

    test('a disconnect during the store read also wins for a forced refresh', async () => {
        let releaseRead: (() => void) | undefined
        const readBlocked = new Promise<void>((resolve) => {
            releaseRead = resolve
        })
        const store = createFakeStore(validTokens, () => readBlocked)
        const service = createRemarkableAuthService(createFakePlugin(), store)

        const pending = service.refreshAndGetUserToken()
        await service.disconnect()
        releaseRead?.()

        expect(await pending).toBeNull()
        expect(store.writes).toEqual([])
    })

    test('isAuthenticated reflects the store', async () => {
        expect(
            await createRemarkableAuthService(
                createFakePlugin(),
                createFakeStore(null)
            ).isAuthenticated()
        ).toBe(false)
        expect(
            await createRemarkableAuthService(
                createFakePlugin(),
                createFakeStore(validTokens)
            ).isAuthenticated()
        ).toBe(true)
    })

    test('disconnect clears the cached token as well as the store', async () => {
        const store = createFakeStore(validTokens)
        const service = createRemarkableAuthService(createFakePlugin(), store)

        // Populate the in-memory cache first.
        expect(await service.getUserToken()).toBe('user-xyz')
        await service.disconnect()

        expect(await service.getUserToken()).toBeNull()
    })
})
