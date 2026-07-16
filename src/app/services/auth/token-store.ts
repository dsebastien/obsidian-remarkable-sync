import { log } from '../../../utils/log'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from 'node:fs'

export interface StoredTokens {
    deviceToken: string
    userToken: string
    userTokenExpiry: number
}

/**
 * Parse and validate raw token file content.
 * Returns null for anything that is not the exact StoredTokens shape —
 * a malformed token file must never crash the caller (the plugin reads
 * it during onload, and a throw there prevents the plugin from loading).
 */
export function parseStoredTokens(content: string): StoredTokens | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(content)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null
    }
    const candidate = parsed as Record<string, unknown>
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

const TOKEN_DIR = '.remarkable-sync'
const TOKEN_FILE = 'token.json'

function getTokenPath(): string {
    return join(homedir(), TOKEN_DIR, TOKEN_FILE)
}

function getTokenDir(): string {
    return join(homedir(), TOKEN_DIR)
}

/**
 * Read stored tokens from the filesystem
 */
export function readTokens(): StoredTokens | null {
    try {
        const content = readFileSync(getTokenPath(), 'utf-8')
        const tokens = parseStoredTokens(content)
        if (!tokens) {
            log('Token file is malformed, treating as disconnected', 'warn')
        }
        return tokens
    } catch {
        return null
    }
}

/**
 * Write tokens to the filesystem.
 * Writes to a temp file first, then renames — an interrupted write must
 * never leave a partially-written token.json behind.
 */
export function writeTokens(tokens: StoredTokens): void {
    try {
        mkdirSync(getTokenDir(), { recursive: true })
        const tokenPath = getTokenPath()
        const tempPath = `${tokenPath}.tmp`
        writeFileSync(tempPath, JSON.stringify(tokens, null, 2), 'utf-8')
        renameSync(tempPath, tokenPath)
        log('Tokens saved', 'debug')
    } catch (error) {
        log('Failed to write tokens', 'error', error)
        throw new Error('Failed to save authentication tokens')
    }
}

/**
 * Delete stored tokens
 */
export function deleteTokens(): void {
    try {
        unlinkSync(getTokenPath())
    } catch {
        // File may not exist — that's fine
    }
    log('Tokens deleted', 'debug')
}

/**
 * Check if valid tokens exist
 */
export function hasValidTokens(): boolean {
    const tokens = readTokens()
    return tokens !== null && tokens.deviceToken.length > 0
}
