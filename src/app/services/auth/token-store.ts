import { Platform } from 'obsidian'
import { log } from '../../../utils/log'
import type { RemarkableSyncPlugin } from '../../plugin'

export interface StoredTokens {
    deviceToken: string
    userToken: string
    userTokenExpiry: number
}

/**
 * Key under which tokens live in the plugin's `data.json`.
 *
 * Deliberately kept out of `PluginSettings`: the settings object is passed to
 * `log(..., 'debug', this.settings)` on every load and save, and users paste
 * their settings into bug reports. Tokens must never travel through either.
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

/**
 * Validate an already-parsed value as `StoredTokens`.
 * Returns null for anything that is not the exact shape.
 */
export function toStoredTokens(value: unknown): StoredTokens | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const candidate = value as Record<string, unknown>
    if (
        typeof candidate['deviceToken'] !== 'string' ||
        typeof candidate['userToken'] !== 'string' ||
        typeof candidate['userTokenExpiry'] !== 'number'
    ) {
        return null
    }
    return {
        deviceToken: candidate['deviceToken'],
        userToken: candidate['userToken'],
        userTokenExpiry: candidate['userTokenExpiry']
    }
}

/**
 * Parse and validate raw stored token content.
 * Returns null for anything that is not the exact StoredTokens shape —
 * malformed stored tokens must never crash the caller (the plugin reads
 * them during onload, and a throw there prevents the plugin from loading).
 */
export function parseStoredTokens(content: string): StoredTokens | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(content)
    } catch {
        return null
    }
    return toStoredTokens(parsed)
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
    try {
        /* eslint-disable import/no-nodejs-modules -- reason: desktop-only legacy token import. These are required lazily behind the Platform.isDesktopApp guard above and are never reached on mobile; a top-level import would be hoisted and break plugin load. */
        return {
            fs: require('node:fs') as typeof import('node:fs'),
            path: require('node:path') as typeof import('node:path'),
            os: require('node:os') as typeof import('node:os')
        }
        /* eslint-enable import/no-nodejs-modules -- reason: see above. */
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

export interface TokenStore {
    read(): Promise<StoredTokens | null>
    write(tokens: StoredTokens): Promise<void>
    clear(): Promise<void>
    hasValid(): Promise<boolean>
}

/**
 * A single `data.json` update. Both fields are written together so the store
 * never leaves a half-applied state behind — most importantly "legacy import
 * recorded, but the imported tokens were not saved", which would lock the user
 * out of a still-valid legacy file forever.
 */
export interface TokenStatePatch {
    /** `null` removes the stored tokens; omitted leaves them untouched. */
    tokens?: StoredTokens | null
    /** Marks the legacy file as consulted for this vault. */
    legacyImportDone?: boolean
}

export interface TokenStoreDeps {
    /** Raw value currently stored under {@link TOKENS_DATA_KEY} in `data.json`. */
    loadStoredTokens(): unknown
    /** Apply a patch to the token entries of `data.json` in one write. */
    persistTokenState(patch: TokenStatePatch): Promise<void>
    /** Raw content of the legacy desktop token file, or null when unavailable. */
    readLegacyTokenFile(): string | null
    /** Whether the legacy file has already been consulted for this vault. */
    isLegacyImportDone(): boolean
}

/**
 * Tokens live in the plugin's `data.json` so the plugin also works on mobile,
 * where nothing outside the vault is writable.
 *
 * Desktop installs created before this change keep their tokens in
 * `~/.remarkable-sync/token.json`. Those are imported on first read and copied
 * into `data.json`; the legacy file is deliberately left on disk (see
 * {@link removeLegacyTokenFile}).
 */
export function createTokenStore(deps: TokenStoreDeps): TokenStore {
    async function read(): Promise<StoredTokens | null> {
        const stored = toStoredTokens(deps.loadStoredTokens())
        if (stored) {
            return stored
        }

        if (deps.isLegacyImportDone()) {
            return null
        }

        const legacyContent = deps.readLegacyTokenFile()
        if (null === legacyContent) {
            return null
        }

        const legacyTokens = parseStoredTokens(legacyContent)
        if (!legacyTokens) {
            log('Legacy token file is malformed, treating as disconnected', 'warn')
            // Nothing to lose by marking it consulted: it will never parse.
            await persistQuietly({ legacyImportDone: true }, 'record the legacy token import')
            return null
        }

        // One-way import: copy in, never delete the source. Tokens and the
        // marker go out in a single write — recording the import without the
        // tokens would permanently skip a legacy file that is still valid.
        const imported = await persistQuietly(
            { tokens: legacyTokens, legacyImportDone: true },
            'import tokens from the legacy token file'
        )
        if (imported) {
            log('Imported tokens from the legacy token file', 'info')
        }
        // Usable for this session either way; a failed write is retried on the
        // next read because the marker was not recorded.
        return legacyTokens
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

    async function write(tokens: StoredTokens): Promise<void> {
        try {
            await deps.persistTokenState({ tokens })
            log('Tokens saved', 'debug')
        } catch (error) {
            log('Failed to write tokens', 'error', error)
            throw new Error('Failed to save authentication tokens')
        }
    }

    async function clear(): Promise<void> {
        // Tokens and marker in one write: the legacy file is never deleted, so
        // a disconnect that dropped the tokens without recording the import
        // would be undone by a re-import on the next read.
        try {
            await deps.persistTokenState({ tokens: null, legacyImportDone: true })
            log('Tokens deleted', 'debug')
        } catch (error) {
            log('Failed to clear tokens', 'error', error)
            throw new Error('Failed to clear authentication tokens')
        }
    }

    async function hasValid(): Promise<boolean> {
        const tokens = await read()
        return null !== tokens && tokens.deviceToken.length > 0
    }

    return { read, write, clear, hasValid }
}

export function createTokenStoreForPlugin(plugin: RemarkableSyncPlugin): TokenStore {
    return createTokenStore({
        loadStoredTokens: () => plugin.getDataValue(TOKENS_DATA_KEY),
        persistTokenState: (patch) => {
            const data: Record<string, unknown> = {}
            if (undefined !== patch.tokens) {
                data[TOKENS_DATA_KEY] = patch.tokens
            }
            if (undefined !== patch.legacyImportDone) {
                data[LEGACY_IMPORT_DONE_DATA_KEY] = patch.legacyImportDone
            }
            return plugin.persistData(data)
        },
        readLegacyTokenFile,
        isLegacyImportDone: () => true === plugin.getDataValue(LEGACY_IMPORT_DONE_DATA_KEY)
    })
}
