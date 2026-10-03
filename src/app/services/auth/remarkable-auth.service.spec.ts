import { test, expect, describe } from 'bun:test'
import { createRemarkableAuthService, failureForStatus } from './remarkable-auth.service'
import type { requestUrl } from 'obsidian'
import type { TokenStore } from './token-store'
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
    writes: string[]
    clears: number
}

function createFakeStore(deviceToken: string | null, onRead?: () => Promise<void>): FakeStore {
    let current = deviceToken
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
        hasValid: async () => Promise.resolve(null !== current),
        state: async () => Promise.resolve(null !== current ? 'connected' : 'not-connected'),
        hasLegacyCopy: () => false,
        removeLegacyCopy: async () => Promise.resolve(),
        changeSecretName: async () => Promise.resolve()
    }
    return store
}

describe('createRemarkableAuthService', () => {
    const validTokens = 'device-abc'
    /** The token endpoint: every user token is derived from the device token. */
    let tokenRequests = 0
    const tokenEndpoint = (() => {
        tokenRequests++
        return Promise.resolve({ status: 200, text: 'user-xyz' })
    }) as unknown as typeof requestUrl

    test('returns the stored user token while it is still valid', async () => {
        const service = createRemarkableAuthService(
            createFakePlugin(),
            createFakeStore(validTokens),
            tokenEndpoint
        )
        expect(await service.getUserToken()).toBe('user-xyz')
    })

    test('returns null once disconnected', async () => {
        const store = createFakeStore(validTokens)
        const service = createRemarkableAuthService(createFakePlugin(), store, tokenEndpoint)

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
        const service = createRemarkableAuthService(createFakePlugin(), store, tokenEndpoint)

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
        const service = createRemarkableAuthService(createFakePlugin(), store, tokenEndpoint)

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
                createFakeStore(null),
                tokenEndpoint
            ).isAuthenticated()
        ).toBe(false)
        expect(
            await createRemarkableAuthService(
                createFakePlugin(),
                createFakeStore(validTokens),
                tokenEndpoint
            ).isAuthenticated()
        ).toBe(true)
    })

    test('the user token lives in memory only, derived once from the device token', async () => {
        const store = createFakeStore(validTokens)
        const service = createRemarkableAuthService(createFakePlugin(), store, tokenEndpoint)
        const before = tokenRequests

        expect(await service.getUserToken()).toBe('user-xyz')
        expect(await service.getUserToken()).toBe('user-xyz')
        expect(tokenRequests - before).toBe(1)
        // Never persisted.
        expect(store.writes).toEqual([])
    })

    test('changing the secret drops the cached user token', async () => {
        const store = createFakeStore(validTokens)
        const service = createRemarkableAuthService(createFakePlugin(), store, tokenEndpoint)
        await service.getUserToken()
        const before = tokenRequests

        await service.useDeviceTokenSecret('other')
        await service.getUserToken()
        expect(tokenRequests - before).toBe(1)
    })

    test('disconnect clears the cached token as well as the store', async () => {
        const store = createFakeStore(validTokens)
        const service = createRemarkableAuthService(createFakePlugin(), store, tokenEndpoint)

        // Populate the in-memory cache first.
        expect(await service.getUserToken()).toBe('user-xyz')
        await service.disconnect()

        expect(await service.getUserToken()).toBeNull()
    })
})

describe('token outcomes', () => {
    const expired = 'device-abc'
    const answering = (outcome: { status: number; text?: string } | Error): typeof requestUrl =>
        (() =>
            Promise.resolve().then(() => {
                if (outcome instanceof Error) throw outcome
                if (outcome.status !== 200) {
                    // requestUrl throws on a non-2xx status, carrying it.
                    throw Object.assign(new Error(`HTTP ${outcome.status}`), {
                        status: outcome.status
                    })
                }
                return { status: 200, text: outcome.text ?? '' }
            })) as unknown as typeof requestUrl

    test.each([400, 401, 403, 404, 422])('%p is a refusal: reconnect', (status) => {
        expect(failureForStatus(status)).toBe('rejected')
    })

    test.each([408, 429, 500, 503])('%p is transient: try again later', (status) => {
        expect(failureForStatus(status)).toBe('unreachable')
    })

    test('no stored tokens: not connected', async () => {
        const service = createRemarkableAuthService(createFakePlugin(), createFakeStore(null))
        expect(await service.acquireUserToken()).toEqual({ failure: 'not-connected' })
        expect(await service.forceRefreshUserToken()).toEqual({ failure: 'not-connected' })
    })

    test('an expired token renewed: the new token', async () => {
        const service = createRemarkableAuthService(
            createFakePlugin(),
            createFakeStore(expired),
            answering({ status: 200, text: 'fresh' })
        )
        expect(await service.acquireUserToken()).toEqual({ token: 'fresh' })
    })

    test('a token endpoint refusing the device token: rejected', async () => {
        const service = createRemarkableAuthService(
            createFakePlugin(),
            createFakeStore(expired),
            answering({ status: 401 })
        )
        expect(await service.acquireUserToken()).toEqual({ failure: 'rejected' })
        expect(await service.forceRefreshUserToken()).toEqual({ failure: 'rejected' })
    })

    test('an offline or failing token endpoint: unreachable, not a reason to reconnect', async () => {
        for (const outcome of [new Error('offline'), { status: 503 }, { status: 429 }]) {
            const service = createRemarkableAuthService(
                createFakePlugin(),
                createFakeStore(expired),
                answering(outcome)
            )
            expect(await service.acquireUserToken()).toEqual({ failure: 'unreachable' })
        }
    })
})
