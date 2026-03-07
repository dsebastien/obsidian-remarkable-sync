import { log } from '../../../utils/log'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'

export interface StoredTokens {
    deviceToken: string
    userToken: string
    userTokenExpiry: number
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
        return JSON.parse(content) as StoredTokens
    } catch {
        return null
    }
}

/**
 * Write tokens to the filesystem
 */
export function writeTokens(tokens: StoredTokens): void {
    try {
        mkdirSync(getTokenDir(), { recursive: true })
        writeFileSync(getTokenPath(), JSON.stringify(tokens, null, 2), 'utf-8')
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
