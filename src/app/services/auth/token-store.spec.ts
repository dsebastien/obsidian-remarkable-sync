import { test, expect, describe } from 'bun:test'
import { createTokenStore, parseStoredTokens, toStoredTokens } from './token-store'
import type { StoredTokens, TokenStatePatch, TokenStoreDeps } from './token-store'

describe('parseStoredTokens', () => {
    const validTokens = {
        deviceToken: 'device-abc',
        userToken: 'user-xyz',
        userTokenExpiry: 1750000000000
    }

    test('returns tokens for a valid file', () => {
        expect(parseStoredTokens(JSON.stringify(validTokens))).toEqual(validTokens)
    })

    test('ignores extra properties', () => {
        const content = JSON.stringify({ ...validTokens, legacyField: true })
        expect(parseStoredTokens(content)).toEqual(validTokens)
    })

    test('returns null for invalid JSON', () => {
        expect(parseStoredTokens('')).toBeNull()
        expect(parseStoredTokens('{"deviceToken": "abc"')).toBeNull()
        expect(parseStoredTokens('not json at all')).toBeNull()
    })

    test('returns null for non-object JSON', () => {
        expect(parseStoredTokens('null')).toBeNull()
        expect(parseStoredTokens('"a string"')).toBeNull()
        expect(parseStoredTokens('42')).toBeNull()
        expect(parseStoredTokens('[1, 2, 3]')).toBeNull()
    })

    test('returns null for an empty object', () => {
        expect(parseStoredTokens('{}')).toBeNull()
    })

    test('returns null when a field is missing', () => {
        const { deviceToken: _deviceToken, ...noDevice } = validTokens
        expect(parseStoredTokens(JSON.stringify(noDevice))).toBeNull()

        const { userToken: _userToken, ...noUser } = validTokens
        expect(parseStoredTokens(JSON.stringify(noUser))).toBeNull()

        const { userTokenExpiry: _expiry, ...noExpiry } = validTokens
        expect(parseStoredTokens(JSON.stringify(noExpiry))).toBeNull()
    })

    test('returns null when a field has the wrong type', () => {
        expect(parseStoredTokens(JSON.stringify({ ...validTokens, deviceToken: null }))).toBeNull()
        expect(parseStoredTokens(JSON.stringify({ ...validTokens, deviceToken: 42 }))).toBeNull()
        expect(parseStoredTokens(JSON.stringify({ ...validTokens, userToken: false }))).toBeNull()
        expect(
            parseStoredTokens(JSON.stringify({ ...validTokens, userTokenExpiry: '123' }))
        ).toBeNull()
    })
})

describe('toStoredTokens', () => {
    test('validates an already-parsed value', () => {
        const tokens = {
            deviceToken: 'device-abc',
            userToken: 'user-xyz',
            userTokenExpiry: 1750000000000
        }
        expect(toStoredTokens(tokens)).toEqual(tokens)
        expect(toStoredTokens({ ...tokens, extra: 1 })).toEqual(tokens)
        expect(toStoredTokens(undefined)).toBeNull()
        expect(toStoredTokens(null)).toBeNull()
        expect(toStoredTokens('nope')).toBeNull()
        expect(toStoredTokens({})).toBeNull()
    })
})

describe('createTokenStore', () => {
    const tokens: StoredTokens = {
        deviceToken: 'device-abc',
        userToken: 'user-xyz',
        userTokenExpiry: 1750000000000
    }

    interface Harness {
        deps: TokenStoreDeps
        patches: TokenStatePatch[]
        legacyReads: number
    }

    function createHarness(options: { stored?: unknown; legacy?: string | null } = {}): Harness {
        let stored: unknown = options.stored
        let legacyImportDone = false
        const harness: Harness = {
            patches: [],
            legacyReads: 0,
            deps: {
                loadStoredTokens: () => stored,
                persistTokenState: async (patch) => {
                    harness.patches.push(patch)
                    if (undefined !== patch.tokens) {
                        stored = patch.tokens ?? undefined
                    }
                    if (undefined !== patch.legacyImportDone) {
                        legacyImportDone = patch.legacyImportDone
                    }
                    await Promise.resolve()
                },
                readLegacyTokenFile: () => {
                    harness.legacyReads++
                    return options.legacy ?? null
                },
                isLegacyImportDone: () => legacyImportDone
            }
        }
        return harness
    }

    test('reads tokens from plugin data without touching the legacy file', async () => {
        const harness = createHarness({ stored: tokens })
        const store = createTokenStore(harness.deps)

        expect(await store.read()).toEqual(tokens)
        expect(harness.legacyReads).toBe(0)
    })

    test('ignores malformed plugin data', async () => {
        const store = createTokenStore(createHarness({ stored: { deviceToken: 42 } }).deps)
        expect(await store.read()).toBeNull()
    })

    test('imports the legacy token file when plugin data has no tokens', async () => {
        const harness = createHarness({ legacy: JSON.stringify(tokens) })
        const store = createTokenStore(harness.deps)

        expect(await store.read()).toEqual(tokens)
        // Tokens and the marker land in a single write...
        expect(harness.patches).toEqual([{ tokens, legacyImportDone: true }])
        // ...so the next read no longer consults the legacy file.
        expect(await store.read()).toEqual(tokens)
        expect(harness.legacyReads).toBe(1)
    })

    test('treats a malformed legacy token file as disconnected', async () => {
        const harness = createHarness({ legacy: 'not json' })
        const store = createTokenStore(harness.deps)

        expect(await store.read()).toBeNull()
        // Marked consulted (it will never parse) but no tokens written.
        expect(harness.patches).toEqual([{ legacyImportDone: true }])
    })

    test('retries the legacy import when the write failed', async () => {
        // Recording the import without saving the tokens would lock the user
        // out of a still-valid legacy file forever.
        const harness = createHarness({ legacy: JSON.stringify(tokens) })
        let failNext = true
        const store = createTokenStore({
            ...harness.deps,
            persistTokenState: async (patch) => {
                if (failNext) {
                    failNext = false
                    throw new Error('disk full')
                }
                await harness.deps.persistTokenState(patch)
            }
        })

        // Usable for this session despite the failed write...
        expect(await store.read()).toEqual(tokens)
        // ...and the import is retried, not skipped.
        expect(await store.read()).toEqual(tokens)
        expect(harness.patches).toEqual([{ tokens, legacyImportDone: true }])
    })

    test('write persists tokens', async () => {
        const harness = createHarness()
        const store = createTokenStore(harness.deps)

        await store.write(tokens)
        expect(harness.patches).toEqual([{ tokens }])
        expect(await store.read()).toEqual(tokens)
    })

    test('write throws a friendly error when persisting fails', async () => {
        const store = createTokenStore({
            ...createHarness().deps,
            persistTokenState: () => Promise.reject(new Error('disk full'))
        })

        expect(store.write(tokens)).rejects.toThrow('Failed to save authentication tokens')
    })

    test('clear removes the tokens and marks the legacy file consulted at once', async () => {
        const harness = createHarness({ stored: tokens })
        const store = createTokenStore(harness.deps)

        await store.clear()
        expect(harness.patches).toEqual([{ tokens: null, legacyImportDone: true }])
        expect(await store.read()).toBeNull()
    })

    test('clear throws when the write fails, so callers do not report success', async () => {
        const store = createTokenStore({
            ...createHarness({ stored: tokens }).deps,
            persistTokenState: () => Promise.reject(new Error('disk full'))
        })

        expect(store.clear()).rejects.toThrow('Failed to clear authentication tokens')
    })

    test('clear stops a never-imported legacy file from reconnecting the user', async () => {
        // Disconnecting a vault that still has the legacy file on disk but has
        // not read it yet must not be undone on the next read.
        const harness = createHarness({ stored: tokens, legacy: JSON.stringify(tokens) })
        const store = createTokenStore(harness.deps)

        await store.clear()
        expect(await store.read()).toBeNull()
        expect(harness.legacyReads).toBe(0)
    })

    test('clear does not re-import the legacy file it already imported', async () => {
        const harness = createHarness({ legacy: JSON.stringify(tokens) })
        const store = createTokenStore(harness.deps)

        await store.read()
        await store.clear()

        // Disconnect must stick: the legacy file is never deleted, so a second
        // read would otherwise silently reconnect the user.
        expect(await store.read()).toBeNull()
    })

    test('hasValid reflects the presence of a device token', async () => {
        expect(await createTokenStore(createHarness().deps).hasValid()).toBe(false)
        expect(await createTokenStore(createHarness({ stored: tokens }).deps).hasValid()).toBe(true)
        expect(
            await createTokenStore(
                createHarness({ stored: { ...tokens, deviceToken: '' } }).deps
            ).hasValid()
        ).toBe(false)
    })
})
