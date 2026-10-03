import { Platform } from 'obsidian'
import { log } from '../../../utils/log'
import type { RemarkableSyncPlugin } from '../../plugin'

/**
 * Key under which tokens used to live in the plugin's `data.json` (up to 2.3).
 *
 * Never written anymore: `data.json` travels with the vault (Obsidian Sync,
 * Git, Syncthing, cloud drives), so a plaintext device token there leaks the
 * pairing to every copy of the vault. Read only to bootstrap each device's
 * secret storage during the grace period, then removed.
 */
export const TOKENS_DATA_KEY = 'tokens'

/**
 * Key marking that the legacy desktop token file has already been consulted for
 * this vault.
 *
 * Required for disconnect to stick: the legacy file is never deleted, so
 * without this marker the read that follows `clear()` would import it again and
 * silently reconnect the user.
 */
export const LEGACY_IMPORT_DONE_DATA_KEY = 'legacyTokensImported'

/** Name the device token is stored under in secret storage unless the user picks another. */
export const DEFAULT_DEVICE_TOKEN_SECRET_NAME = 'remarkable-synchronizer-device-token'

/** Secret storage ids: lowercase alphanumeric with optional dashes (Obsidian throws otherwise). */
const SECRET_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSecretName(name: string): boolean {
    return SECRET_NAME_PATTERN.test(name)
}

/**
 * Extract the device token from a legacy stored-token value (the `tokens`
 * entry of `data.json`, or the parsed legacy desktop file).
 *
 * Only the device token matters: the user token is short-lived and is
 * regenerated from it. Returns null for anything without a non-empty string
 * `deviceToken` — malformed stored tokens must never crash the caller (the
 * plugin reads them during onload, and a throw there prevents it loading).
 */
export function toLegacyDeviceToken(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const deviceToken = (value as Record<string, unknown>)['deviceToken']
    return typeof deviceToken === 'string' && deviceToken.length > 0 ? deviceToken : null
}

/** {@link toLegacyDeviceToken} for raw file content. */
export function parseLegacyDeviceToken(content: string): string | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(content)
    } catch {
        return null
    }
    return toLegacyDeviceToken(parsed)
}

/** The part of Obsidian's `SecretStorage` the token store uses. */
export interface SecretStore {
    getSecret(id: string): string | null
    setSecret(id: string, secret: string): void
}

/**
 * A name under which `value` can be stored without overwriting a different
 * secret: `preferred` when it is free or already holds `value`, otherwise the
 * first free `preferred-N`. Secret storage is shared by every vault and plugin
 * on the device, so a name taken by something else must never be clobbered.
 */
export function chooseSecretName(secrets: SecretStore, preferred: string, value: string): string {
    const usable = (name: string): boolean => {
        const existing = secrets.getSecret(name)
        return null === existing || '' === existing || existing === value
    }
    if (usable(preferred)) {
        return preferred
    }
    for (let suffix = 2; suffix < 1000; suffix++) {
        const candidate = `${preferred}-${suffix}`
        if (usable(candidate)) {
            return candidate
        }
    }
    throw new Error('No free secret name')
}

// ---------------------------------------------------------------------------
// Legacy desktop token file
// ---------------------------------------------------------------------------

const LEGACY_TOKEN_DIR = '.remarkable-sync'
const LEGACY_TOKEN_FILE = 'token.json'

/**
 * Node's `fs`/`os`/`path`, loaded lazily.
 *
 * MUST stay a function-scoped require. A top-level `import` of a Node builtin
 * is hoisted by the bundler into a top-level `require("node:fs")`, which runs
 * the moment `main.js` is evaluated and throws on mobile — preventing the
 * plugin from loading at all. Inside a function it is only ever evaluated on
 * desktop.
 */
function loadNodeModules(): {
    fs: typeof import('node:fs')
    path: typeof import('node:path')
    os: typeof import('node:os')
} | null {
    if (!Platform.isDesktopApp) {
        return null
    }
    // Electron's runtime require, not a `require()`/`import()` of `node:*`:
    // the catalog's no-nodejs-modules rules flag those in a plugin that also
    // runs on mobile, and this path is desktop-only (gated above).
    const electronRequire = (window as { require?: (id: string) => unknown }).require
    if (!electronRequire) {
        return null
    }
    try {
        return {
            fs: electronRequire('fs') as typeof import('node:fs'),
            path: electronRequire('path') as typeof import('node:path'),
            os: electronRequire('os') as typeof import('node:os')
        }
    } catch {
        return null
    }
}

function getLegacyTokenPath(): string | null {
    const node = loadNodeModules()
    if (!node) {
        return null
    }
    try {
        return node.path.join(node.os.homedir(), LEGACY_TOKEN_DIR, LEGACY_TOKEN_FILE)
    } catch {
        return null
    }
}

/**
 * Read the legacy desktop token file, if it still exists.
 * Returns null on mobile and whenever the file is missing or unreadable.
 */
export function readLegacyTokenFile(): string | null {
    const node = loadNodeModules()
    const tokenPath = getLegacyTokenPath()
    if (!node || null === tokenPath) {
        return null
    }
    try {
        return node.fs.readFileSync(tokenPath, 'utf-8')
    } catch {
        return null
    }
}

/**
 * Whether the legacy desktop token file is still present on disk.
 * Drives the "Legacy token file" control in the settings tab.
 */
export function legacyTokenFileExists(): boolean {
    const node = loadNodeModules()
    const tokenPath = getLegacyTokenPath()
    if (!node || null === tokenPath) {
        return false
    }
    try {
        return node.fs.existsSync(tokenPath)
    } catch {
        return false
    }
}

/**
 * Delete the legacy desktop token file. Only ever called from an explicit user
 * action: the file is machine-global and shared by every vault on that machine,
 * so removing it automatically after one vault imported it would silently
 * disconnect the user's other vaults.
 */
export function removeLegacyTokenFile(): boolean {
    const node = loadNodeModules()
    const tokenPath = getLegacyTokenPath()
    if (!node || null === tokenPath) {
        return false
    }
    try {
        node.fs.unlinkSync(tokenPath)
        log('Legacy token file removed', 'info')
        return true
    } catch (error) {
        log('Failed to remove the legacy token file', 'error', error)
        return false
    }
}

// ---------------------------------------------------------------------------
// Token store
// ---------------------------------------------------------------------------

/**
 * How long the plaintext `tokens` entry of `data.json` is kept after the first
 * migration. During this grace period every synced device bootstraps its own
 * (device-local) secret storage from it on its next start; deleting it on the
 * first device to migrate would log out every other device.
 */
export const LEGACY_TOKENS_GRACE_PERIOD_MS = 60 * 24 * 60 * 60 * 1000

/**
 * Connection state as far as stored credentials go:
 * - `connected`: a device token is available on this device.
 * - `not-connected`: this vault was never paired (or was disconnected).
 * - `missing-on-device`: the vault is paired (its synced `data.json` names the
 *   secret) but neither this device's secret storage nor the plaintext copy
 *   has the device token. Normal on a device that starts after the plaintext
 *   copy was removed, until the user connects there once.
 */
export type CredentialState = 'connected' | 'not-connected' | 'missing-on-device'

export interface TokenStore {
    /** The device token, or null when there is none on this device. */
    read(): Promise<string | null>
    /** Store a new device token (a fresh pairing). Removes the stale plaintext copy. */
    write(deviceToken: string): Promise<void>
    /** Forget the pairing: this device's secret, the plaintext copy and the secret name. */
    clear(): Promise<void>
    hasValid(): Promise<boolean>
    state(): Promise<CredentialState>
    /** Whether `data.json` still carries the plaintext `tokens` entry. */
    hasLegacyCopy(): boolean
    /** Remove the plaintext `tokens` entry from `data.json` now. */
    removeLegacyCopy(): Promise<void>
    /**
     * Point the store at another secret name (picked by the user). The
     * plaintext copy is dropped: a changed secret makes it stale.
     */
    changeSecretName(name: string): Promise<void>
}

/**
 * A single `data.json` update. Fields are written together so the store never
 * leaves a half-applied state behind — most importantly "legacy import
 * recorded, but the secret name not saved", which would lock the user out of a
 * still-valid legacy file forever.
 */
export interface TokenStatePatch {
    /** New secret name setting; `''` means "not paired". Omitted leaves it untouched. */
    secretName?: string
    /** ISO date of the first migration out of the plaintext entry. */
    migratedAt?: string
    /** Remove the legacy plaintext `tokens` entry. */
    removeLegacyTokens?: true
    /** Marks the legacy file as consulted for this vault. */
    legacyImportDone?: boolean
}

export interface TokenStoreDeps {
    secrets: SecretStore
    /** Name of the secret holding the device token; `''` when never paired. */
    getSecretName(): string
    /** ISO date of the first migration out of the plaintext entry; `''` when none. */
    getMigratedAt(): string
    /** Raw value stored under {@link TOKENS_DATA_KEY} in `data.json` (pre-2.4). */
    loadLegacyTokens(): unknown
    /** Apply a patch to the settings and token entries of `data.json` in one write. */
    persistTokenState(patch: TokenStatePatch): Promise<void>
    /** Raw content of the legacy desktop token file, or null when unavailable. */
    readLegacyTokenFile(): string | null
    /** Whether the legacy file has already been consulted for this vault. */
    isLegacyImportDone(): boolean
    now(): number
}

/**
 * The device token lives in Obsidian's secret storage; `data.json` holds the
 * secret's name and, never written again, the pre-2.4 plaintext copy.
 * The user token is never stored: it is short-lived and the auth service
 * regenerates it from the device token.
 *
 * Migration is per device, because secret storage is device-local while
 * `data.json` is synced: a device whose secret storage has no token
 * bootstraps it from the plaintext `tokens` entry, which is kept read-only for
 * {@link LEGACY_TOKENS_GRACE_PERIOD_MS} after the first migration, then
 * removed. A new pairing, a changed secret, a disconnect or the settings
 * button remove it earlier.
 *
 * Desktop installs predating `data.json` storage keep their tokens in
 * `~/.remarkable-sync/token.json`, imported into secret storage once per vault
 * and deliberately left on disk (see {@link removeLegacyTokenFile}).
 */
export function createTokenStore(deps: TokenStoreDeps): TokenStore {
    function getSecretQuietly(name: string): string | null {
        try {
            const value = deps.secrets.getSecret(name)
            return value && value.length > 0 ? value : null
        } catch (error) {
            log('Failed to read the device token from secret storage', 'error', error)
            return null
        }
    }

    function setSecretQuietly(name: string, value: string): boolean {
        try {
            deps.secrets.setSecret(name, value)
            return true
        } catch (error) {
            log('Failed to store the device token in secret storage', 'error', error)
            return false
        }
    }

    /** Persist a patch, logging rather than throwing. Returns whether it stuck. */
    async function persistQuietly(patch: TokenStatePatch, what: string): Promise<boolean> {
        try {
            await deps.persistTokenState(patch)
            return true
        } catch (error) {
            log(`Failed to ${what}`, 'error', error)
            return false
        }
    }

    function legacyCopy(): string | null {
        return toLegacyDeviceToken(deps.loadLegacyTokens())
    }

    function hasLegacyCopy(): boolean {
        const raw = deps.loadLegacyTokens()
        return undefined !== raw && null !== raw
    }

    function gracePeriodOver(): boolean {
        const migratedAt = Date.parse(deps.getMigratedAt())
        return (
            Number.isFinite(migratedAt) && deps.now() - migratedAt > LEGACY_TOKENS_GRACE_PERIOD_MS
        )
    }

    /**
     * Copy the plaintext device token into this device's secret storage.
     * Idempotent: a device whose secret already holds it changes nothing, and
     * the plaintext entry is left for the other devices.
     *
     * Returns the device token, usable for this session even when secret
     * storage or the `data.json` write failed (both are retried next read).
     */
    async function bootstrapFromLegacy(deviceToken: string): Promise<string> {
        const configured = deps.getSecretName()
        let name: string
        try {
            // A configured name is this vault's own secret (it is empty here,
            // or read() would not have come this far). A first migration picks
            // a name that does not clobber another vault's or plugin's secret.
            name =
                configured ||
                chooseSecretName(deps.secrets, DEFAULT_DEVICE_TOKEN_SECRET_NAME, deviceToken)
        } catch (error) {
            log('Failed to pick a secret name for the device token', 'error', error)
            return deviceToken
        }
        if (!setSecretQuietly(name, deviceToken)) {
            return deviceToken
        }

        const patch: TokenStatePatch = {}
        if (name !== configured) {
            patch.secretName = name
        }
        if (!deps.getMigratedAt()) {
            patch.migratedAt = new Date(deps.now()).toISOString()
        }
        if (Object.keys(patch).length > 0) {
            await persistQuietly(patch, 'record the device token migration')
        }
        log('Copied the device token from data.json into secret storage', 'info')
        return deviceToken
    }

    async function importLegacyFile(): Promise<string | null> {
        if (deps.isLegacyImportDone()) {
            return null
        }

        const legacyContent = deps.readLegacyTokenFile()
        if (null === legacyContent) {
            return null
        }

        const deviceToken = parseLegacyDeviceToken(legacyContent)
        if (!deviceToken) {
            log('Legacy token file is malformed, treating as disconnected', 'warn')
            // Nothing to lose by marking it consulted: it will never parse.
            await persistQuietly({ legacyImportDone: true }, 'record the legacy token import')
            return null
        }

        let name: string
        try {
            name = chooseSecretName(deps.secrets, DEFAULT_DEVICE_TOKEN_SECRET_NAME, deviceToken)
        } catch (error) {
            log('Failed to pick a secret name for the device token', 'error', error)
            return deviceToken
        }
        if (!setSecretQuietly(name, deviceToken)) {
            // Not recorded as consulted, so the import is retried next time.
            return deviceToken
        }

        // One-way import: copy in, never delete the source. Name and marker go
        // out in a single write — recording the import without the name would
        // permanently skip a legacy file that is still valid.
        const imported = await persistQuietly(
            { secretName: name, legacyImportDone: true },
            'import tokens from the legacy token file'
        )
        if (imported) {
            log('Imported the device token from the legacy token file', 'info')
        }
        return deviceToken
    }

    async function readToken(): Promise<string | null> {
        const name = deps.getSecretName()
        if (name) {
            const stored = getSecretQuietly(name)
            if (stored) {
                return stored
            }
        }

        const legacy = legacyCopy()
        if (legacy) {
            return bootstrapFromLegacy(legacy)
        }

        if (name) {
            // Paired, but nothing on this device: the caller reports it. A
            // pairing is never silently replaced.
            return null
        }

        return importLegacyFile()
    }

    async function read(): Promise<string | null> {
        const token = await readToken()
        // Purge only once this device holds the token in secret storage (it
        // was just bootstrapped above if needed), so the purge never logs out
        // the device doing it.
        if (null !== token && hasLegacyCopy() && gracePeriodOver()) {
            const name = deps.getSecretName()
            if (name && getSecretQuietly(name) === token) {
                const removed = await persistQuietly(
                    { removeLegacyTokens: true },
                    'remove the plain-text device token'
                )
                if (removed) {
                    log('Removed the plain-text device token (grace period over)', 'info')
                }
            }
        } else if (null === token && hasLegacyCopy() && null === legacyCopy()) {
            // Malformed leftovers carry nothing usable.
            await persistQuietly({ removeLegacyTokens: true }, 'remove malformed stored tokens')
        }
        return token
    }

    async function state(): Promise<CredentialState> {
        if (null !== (await read())) {
            return 'connected'
        }
        return deps.getSecretName() ? 'missing-on-device' : 'not-connected'
    }

    async function write(deviceToken: string): Promise<void> {
        const current = deps.getSecretName()
        let name: string
        try {
            // Reconnecting overwrites this vault's own secret; a first pairing
            // picks a name that does not clobber anything else's.
            name =
                current ||
                chooseSecretName(deps.secrets, DEFAULT_DEVICE_TOKEN_SECRET_NAME, deviceToken)
            deps.secrets.setSecret(name, deviceToken)
        } catch (error) {
            log('Failed to store the device token in secret storage', 'error', error)
            throw new Error('Failed to save authentication tokens')
        }
        // Never written to data.json; the plaintext copy, if any, is now stale.
        const patch: TokenStatePatch = {}
        if (name !== current) {
            patch.secretName = name
        }
        if (hasLegacyCopy()) {
            patch.removeLegacyTokens = true
        }
        if (Object.keys(patch).length === 0) {
            log('Device token saved', 'debug')
            return
        }
        try {
            await deps.persistTokenState(patch)
            log('Device token saved', 'debug')
        } catch (error) {
            log('Failed to write tokens', 'error', error)
            throw new Error('Failed to save authentication tokens')
        }
    }

    async function clear(): Promise<void> {
        const name = deps.getSecretName()
        if (name) {
            try {
                // Secret storage has no delete; an empty value reads as absent.
                deps.secrets.setSecret(name, '')
            } catch (error) {
                log('Failed to clear the device token from secret storage', 'warn', error)
            }
        }
        // Name, plaintext copy and marker in one write: the legacy file is
        // never deleted, so a disconnect that dropped the name without
        // recording the import would be undone by a re-import on the next
        // read. Removing the plaintext copy logs out every synced device, as
        // disconnecting always did.
        try {
            await deps.persistTokenState({
                secretName: '',
                removeLegacyTokens: true,
                legacyImportDone: true
            })
            log('Tokens deleted', 'debug')
        } catch (error) {
            log('Failed to clear tokens', 'error', error)
            throw new Error('Failed to clear authentication tokens')
        }
    }

    async function removeLegacyCopy(): Promise<void> {
        if (!hasLegacyCopy()) {
            return
        }
        // Make sure this device keeps working before dropping the copy.
        await readToken()
        await deps.persistTokenState({ removeLegacyTokens: true })
        log('Removed the plain-text device token', 'info')
    }

    async function changeSecretName(name: string): Promise<void> {
        if (!isValidSecretName(name)) {
            throw new Error('Secret names use lowercase letters, digits and dashes.')
        }
        const patch: TokenStatePatch = { secretName: name }
        if (hasLegacyCopy()) {
            patch.removeLegacyTokens = true
        }
        await deps.persistTokenState(patch)
    }

    async function hasValid(): Promise<boolean> {
        return null !== (await read())
    }

    return {
        read,
        write,
        clear,
        hasValid,
        state,
        hasLegacyCopy,
        removeLegacyCopy,
        changeSecretName
    }
}

export function createTokenStoreForPlugin(plugin: RemarkableSyncPlugin): TokenStore {
    return createTokenStore({
        secrets: plugin.app.secretStorage,
        getSecretName: () => plugin.settings.deviceTokenSecretName,
        getMigratedAt: () => plugin.settings.legacySecretMigratedAt,
        loadLegacyTokens: () => plugin.getDataValue(TOKENS_DATA_KEY),
        persistTokenState: (patch) => {
            const data: Record<string, unknown> = {}
            if (patch.removeLegacyTokens) {
                // mergePluginData removes a key whose patch value is null.
                data[TOKENS_DATA_KEY] = null
            }
            if (undefined !== patch.legacyImportDone) {
                data[LEGACY_IMPORT_DONE_DATA_KEY] = patch.legacyImportDone
            }
            const { secretName, migratedAt } = patch
            return plugin.updateSettings((draft) => {
                if (undefined !== secretName) {
                    draft.deviceTokenSecretName = secretName
                }
                if (undefined !== migratedAt) {
                    draft.legacySecretMigratedAt = migratedAt
                }
            }, data)
        },
        readLegacyTokenFile,
        isLegacyImportDone: () => true === plugin.getDataValue(LEGACY_IMPORT_DONE_DATA_KEY),
        now: () => Date.now()
    })
}
