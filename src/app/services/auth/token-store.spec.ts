import { afterEach, test, expect, describe } from 'bun:test'
import { Platform } from 'obsidian'
import {
    chooseSecretName,
    createTokenStore,
    DEFAULT_DEVICE_TOKEN_SECRET_NAME,
    isValidSecretName,
    LEGACY_TOKENS_GRACE_PERIOD_MS,
    legacyTokenFileExists,
    parseLegacyDeviceToken,
    readLegacyTokenFile,
    toLegacyDeviceToken
} from './token-store'
import type { SecretStore, TokenStatePatch, TokenStoreDeps } from './token-store'

const NAME = DEFAULT_DEVICE_TOKEN_SECRET_NAME
const legacyTokens = {
    deviceToken: 'device-abc',
    userToken: 'user-xyz',
    userTokenExpiry: 1750000000000
}

describe('toLegacyDeviceToken / parseLegacyDeviceToken', () => {
    test('extracts the device token, ignoring the rest', () => {
        expect(toLegacyDeviceToken(legacyTokens)).toBe('device-abc')
        expect(toLegacyDeviceToken({ deviceToken: 'd' })).toBe('d')
        expect(parseLegacyDeviceToken(JSON.stringify(legacyTokens))).toBe('device-abc')
    })

    test('returns null for anything without a non-empty string device token', () => {
        for (const value of [
            undefined,
            null,
            'nope',
            42,
            {},
            { deviceToken: '' },
            { deviceToken: 42 }
        ]) {
            expect(toLegacyDeviceToken(value)).toBeNull()
        }
        expect(parseLegacyDeviceToken('')).toBeNull()
        expect(parseLegacyDeviceToken('not json')).toBeNull()
        expect(parseLegacyDeviceToken('[1, 2]')).toBeNull()
    })
})

describe('secret names', () => {
    test('validates the secret storage id format', () => {
        expect(isValidSecretName(NAME)).toBe(true)
        expect(isValidSecretName('a1-b2')).toBe(true)
        for (const name of ['', 'Upper', 'with space', '-lead', 'trail-', 'a--b', 'a_b']) {
            expect(isValidSecretName(name)).toBe(false)
        }
    })

    test('chooseSecretName never clobbers a different secret', () => {
        const secrets = createSecrets({ [NAME]: 'other', [`${NAME}-2`]: 'other-2' })
        expect(chooseSecretName(secrets, NAME, 'mine')).toBe(`${NAME}-3`)
        expect(chooseSecretName(secrets, NAME, 'other')).toBe(NAME)
        expect(chooseSecretName(createSecrets({ [NAME]: '' }), NAME, 'mine')).toBe(NAME)
    })
})

function createSecrets(initial: Record<string, string> = {}): SecretStore & {
    values: Record<string, string>
} {
    const values: Record<string, string> = { ...initial }
    return {
        values,
        getSecret: (id) => values[id] ?? null,
        setSecret: (id, secret) => {
            values[id] = secret
        }
    }
}

const DAY = 24 * 60 * 60 * 1000

interface Harness {
    deps: TokenStoreDeps
    patches: TokenStatePatch[]
    secrets: ReturnType<typeof createSecrets>
    /** Simulated synced data.json. */
    data: { secretName: string; migratedAt: string; tokens: unknown; legacyImportDone: boolean }
    legacyReads: number
    clock: { now: number }
}

function createHarness(
    options: {
        tokens?: unknown
        secretName?: string
        migratedAt?: string
        secrets?: Record<string, string>
        legacy?: string | null
        failPersist?: () => boolean
    } = {}
): Harness {
    const harness: Harness = {
        patches: [],
        legacyReads: 0,
        secrets: createSecrets(options.secrets),
        clock: { now: Date.parse('2026-10-03T00:00:00.000Z') },
        data: {
            secretName: options.secretName ?? '',
            migratedAt: options.migratedAt ?? '',
            tokens: options.tokens,
            legacyImportDone: false
        },
        deps: undefined as unknown as TokenStoreDeps
    }
    harness.deps = {
        secrets: harness.secrets,
        getSecretName: () => harness.data.secretName,
        getMigratedAt: () => harness.data.migratedAt,
        loadLegacyTokens: () => harness.data.tokens,
        persistTokenState: async (patch) => {
            await Promise.resolve()
            if (options.failPersist?.()) {
                throw new Error('disk full')
            }
            harness.patches.push(patch)
            if (undefined !== patch.secretName) harness.data.secretName = patch.secretName
            if (undefined !== patch.migratedAt) harness.data.migratedAt = patch.migratedAt
            if (patch.removeLegacyTokens) harness.data.tokens = undefined
            if (undefined !== patch.legacyImportDone) {
                harness.data.legacyImportDone = patch.legacyImportDone
            }
        },
        readLegacyTokenFile: () => {
            harness.legacyReads++
            return options.legacy ?? null
        },
        isLegacyImportDone: () => harness.data.legacyImportDone,
        now: () => harness.clock.now
    }
    return harness
}

/** A second device: same synced data.json, its own (empty) secret storage. */
function otherDevice(from: Harness): Harness {
    const device = createHarness({
        tokens: from.data.tokens,
        secretName: from.data.secretName,
        migratedAt: from.data.migratedAt
    })
    device.clock.now = from.clock.now
    return device
}

describe('createTokenStore: migration from plaintext data.json tokens', () => {
    test('first device: copies the token into secret storage and keeps the plaintext copy', async () => {
        const harness = createHarness({ tokens: legacyTokens })
        const store = createTokenStore(harness.deps)

        expect(await store.read()).toBe('device-abc')
        expect(harness.secrets.values[NAME]).toBe('device-abc')
        expect(harness.data.secretName).toBe(NAME)
        expect(harness.data.migratedAt).toBe('2026-10-03T00:00:00.000Z')
        // Kept for the other synced devices.
        expect(harness.data.tokens).toEqual(legacyTokens)
        expect(store.hasLegacyCopy()).toBe(true)
    })

    test('is idempotent', async () => {
        const harness = createHarness({ tokens: legacyTokens })
        const store = createTokenStore(harness.deps)

        await store.read()
        const patches = harness.patches.length
        expect(await store.read()).toBe('device-abc')
        expect(await store.state()).toBe('connected')
        expect(harness.patches.length).toBe(patches)
    })

    test('device B (synced data.json, empty secret storage) bootstraps and stays connected', async () => {
        const deviceA = createHarness({ tokens: legacyTokens })
        await createTokenStore(deviceA.deps).read()

        const deviceB = otherDevice(deviceA)
        const storeB = createTokenStore(deviceB.deps)
        expect(await storeB.state()).toBe('connected')
        expect(deviceB.secrets.values[NAME]).toBe('device-abc')
        // Name and first-migration date already set: no data.json write.
        expect(deviceB.patches).toEqual([])
    })

    test('does not overwrite a different secret already using the default name', async () => {
        const harness = createHarness({ tokens: legacyTokens, secrets: { [NAME]: 'other-vault' } })
        expect(await createTokenStore(harness.deps).read()).toBe('device-abc')
        expect(harness.secrets.values[NAME]).toBe('other-vault')
        expect(harness.secrets.values[`${NAME}-2`]).toBe('device-abc')
        expect(harness.data.secretName).toBe(`${NAME}-2`)
    })

    test('prefers secret storage over the plaintext copy', async () => {
        const harness = createHarness({
            tokens: legacyTokens,
            secretName: NAME,
            migratedAt: '2026-10-01T00:00:00.000Z',
            secrets: { [NAME]: 'rotated' }
        })
        expect(await createTokenStore(harness.deps).read()).toBe('rotated')
    })

    test('works for the session when secret storage refuses the value', async () => {
        const harness = createHarness({ tokens: legacyTokens })
        harness.deps.secrets = {
            getSecret: () => null,
            setSecret: () => {
                throw new Error('nope')
            }
        }
        expect(await createTokenStore(harness.deps).read()).toBe('device-abc')
        expect(harness.data.tokens).toEqual(legacyTokens)
        expect(harness.patches).toEqual([])
    })

    test('removes malformed plaintext tokens', async () => {
        const harness = createHarness({ tokens: { deviceToken: 42 } })
        const store = createTokenStore(harness.deps)
        expect(await store.read()).toBeNull()
        expect(harness.data.tokens).toBeUndefined()
    })
})

describe('createTokenStore: plaintext copy removal', () => {
    test('purges the plaintext copy once the 60-day grace period is over', async () => {
        const harness = createHarness({ tokens: legacyTokens })
        const store = createTokenStore(harness.deps)
        await store.read()

        harness.clock.now += LEGACY_TOKENS_GRACE_PERIOD_MS - DAY
        await store.read()
        expect(store.hasLegacyCopy()).toBe(true)

        harness.clock.now += 2 * DAY
        expect(await store.read()).toBe('device-abc')
        expect(store.hasLegacyCopy()).toBe(false)
        // Still connected from secret storage.
        expect(await store.state()).toBe('connected')
    })

    test('a device bootstrapping after the grace period still migrates before purging', async () => {
        const harness = createHarness({
            tokens: legacyTokens,
            secretName: NAME,
            migratedAt: '2026-01-01T00:00:00.000Z'
        })
        const store = createTokenStore(harness.deps)
        expect(await store.read()).toBe('device-abc')
        expect(harness.secrets.values[NAME]).toBe('device-abc')
        expect(store.hasLegacyCopy()).toBe(false)
    })

    test('the settings button removes the plaintext copy now, keeping this device connected', async () => {
        const harness = createHarness({
            tokens: legacyTokens,
            secretName: NAME,
            migratedAt: '2026-10-01T00:00:00.000Z'
        })
        const store = createTokenStore(harness.deps)

        await store.removeLegacyCopy()
        expect(harness.data.tokens).toBeUndefined()
        expect(harness.secrets.values[NAME]).toBe('device-abc')
        expect(await store.state()).toBe('connected')
    })

    test('a new pairing (rotation) writes secret storage only and drops the stale copy', async () => {
        const harness = createHarness({ tokens: legacyTokens })
        const store = createTokenStore(harness.deps)
        await store.read()

        await store.write('device-new')
        expect(harness.secrets.values[NAME]).toBe('device-new')
        expect(harness.data.tokens).toBeUndefined()
        expect(await store.read()).toBe('device-new')
        expect(JSON.stringify(harness.patches)).not.toContain('device-new')
    })

    test('changing the secret name drops the stale copy', async () => {
        const harness = createHarness({ tokens: legacyTokens })
        const store = createTokenStore(harness.deps)
        await store.read()
        harness.secrets.values['picked'] = 'device-picked'

        await store.changeSecretName('picked')
        expect(harness.data.tokens).toBeUndefined()
        expect(await store.read()).toBe('device-picked')
        expect(store.changeSecretName('Not Valid')).rejects.toThrow()
    })

    test('disconnect clears this device secret, the plaintext copy and the name', async () => {
        const harness = createHarness({ tokens: legacyTokens })
        const store = createTokenStore(harness.deps)
        await store.read()

        await store.clear()
        expect(harness.secrets.values[NAME]).toBe('')
        expect(harness.data.tokens).toBeUndefined()
        expect(harness.data.secretName).toBe('')
        expect(await store.state()).toBe('not-connected')
        // And the other devices are logged out too, as before.
        expect(await createTokenStore(otherDevice(harness).deps).state()).toBe('not-connected')
    })
})

describe('createTokenStore: missing on this device', () => {
    test('paired elsewhere, no secret here, no plaintext copy: missing-on-device', async () => {
        const harness = createHarness({ secretName: NAME })
        const store = createTokenStore(harness.deps)
        expect(await store.read()).toBeNull()
        expect(await store.state()).toBe('missing-on-device')
        expect(harness.patches).toEqual([])
        expect(harness.legacyReads).toBe(0)
    })

    test('never paired: not-connected', async () => {
        expect(await createTokenStore(createHarness().deps).state()).toBe('not-connected')
    })

    test('a fresh pairing stores the token in secret storage only', async () => {
        const harness = createHarness()
        const store = createTokenStore(harness.deps)
        await store.write('device-abc')
        expect(harness.secrets.values[NAME]).toBe('device-abc')
        expect(harness.patches).toEqual([{ secretName: NAME }])
        expect(await store.hasValid()).toBe(true)
    })

    test('write throws a friendly error when persisting fails', () => {
        const store = createTokenStore(createHarness({ failPersist: () => true }).deps)
        expect(store.write('device-abc')).rejects.toThrow('Failed to save authentication tokens')
    })

    test('clear throws when the write fails, so callers do not report success', () => {
        const store = createTokenStore(
            createHarness({ secretName: NAME, failPersist: () => true }).deps
        )
        expect(store.clear()).rejects.toThrow('Failed to clear authentication tokens')
    })
})

describe('createTokenStore: legacy desktop token file', () => {
    test('imports it into secret storage when the vault is not paired', async () => {
        const harness = createHarness({ legacy: JSON.stringify(legacyTokens) })
        const store = createTokenStore(harness.deps)

        expect(await store.read()).toBe('device-abc')
        expect(harness.secrets.values[NAME]).toBe('device-abc')
        // Name and marker land in a single write...
        expect(harness.patches).toEqual([{ secretName: NAME, legacyImportDone: true }])
        // ...so the next read no longer consults the legacy file.
        expect(await store.read()).toBe('device-abc')
        expect(harness.legacyReads).toBe(1)
    })

    test('treats a malformed legacy token file as disconnected', async () => {
        const harness = createHarness({ legacy: 'not json' })
        expect(await createTokenStore(harness.deps).read()).toBeNull()
        expect(harness.patches).toEqual([{ legacyImportDone: true }])
    })

    test('retries the import when the write failed', async () => {
        let failNext = true
        const harness = createHarness({
            legacy: JSON.stringify(legacyTokens),
            failPersist: () => {
                const fail = failNext
                failNext = false
                return fail
            }
        })
        const store = createTokenStore(harness.deps)

        // Usable for this session despite the failed write...
        expect(await store.read()).toBe('device-abc')
        // ...and the import is retried, not skipped.
        expect(await store.read()).toBe('device-abc')
        expect(harness.patches).toEqual([{ secretName: NAME, legacyImportDone: true }])
    })

    test('clear stops the legacy file from reconnecting the user', async () => {
        const harness = createHarness({ legacy: JSON.stringify(legacyTokens) })
        const store = createTokenStore(harness.deps)

        await store.read()
        await store.clear()
        expect(await store.read()).toBeNull()
        expect(harness.legacyReads).toBe(1)
    })
})

describe('legacy token file (desktop)', () => {
    afterEach(() => {
        Reflect.set(Platform, 'isDesktopApp', false)
        Reflect.deleteProperty(window, 'require')
    })

    function stubElectronRequire(files: Record<string, string>): string[] {
        const requested: string[] = []
        const modules: Record<string, unknown> = {
            fs: {
                readFileSync: (path: string): string => {
                    const content = files[path]
                    if (content === undefined) {
                        throw new Error('ENOENT')
                    }
                    return content
                },
                existsSync: (path: string): boolean => path in files
            },
            path: { join: (...parts: string[]): string => parts.join('/') },
            os: { homedir: (): string => '/home/u' }
        }
        Reflect.set(window, 'require', (id: string): unknown => {
            requested.push(id)
            return modules[id]
        })
        return requested
    }

    test("reads the file through Electron's require, by bare module ids", () => {
        Reflect.set(Platform, 'isDesktopApp', true)
        const requested = stubElectronRequire({ '/home/u/.remarkable-sync/token.json': '{"x":1}' })
        expect(readLegacyTokenFile()).toBe('{"x":1}')
        expect(legacyTokenFileExists()).toBe(true)
        expect(new Set(requested)).toEqual(new Set(['fs', 'path', 'os']))
    })

    test('is absent when Electron exposes no require', () => {
        Reflect.set(Platform, 'isDesktopApp', true)
        expect(readLegacyTokenFile()).toBeNull()
        expect(legacyTokenFileExists()).toBe(false)
    })

    test('is never looked up off desktop', () => {
        const requested = stubElectronRequire({ '/home/u/.remarkable-sync/token.json': '{}' })
        expect(readLegacyTokenFile()).toBeNull()
        expect(requested).toEqual([])
    })
})
