import { log } from '../../../utils/log'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'

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
        const tokenPath = getTokenPath()
        if (!existsSync(tokenPath)) {
            return null
        }
        const content = readFileSync(tokenPath, 'utf-8')
        return JSON.parse(content) as StoredTokens
    } catch (error) {
        log('Failed to read tokens', 'error', error)
        return null
    }
}

/**
 * Write tokens to the filesystem
 */
export function writeTokens(tokens: StoredTokens): void {
    try {
        const tokenDir = getTokenDir()
        if (!existsSync(tokenDir)) {
            mkdirSync(tokenDir, { recursive: true })
        }
        const tokenPath = getTokenPath()
        writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8')
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
        const tokenPath = getTokenPath()
        if (existsSync(tokenPath)) {
            unlinkSync(tokenPath)
        }
        log('Tokens deleted', 'debug')
    } catch (error) {
        log('Failed to delete tokens', 'error', error)
    }
}

/**
 * Check if valid tokens exist
 */
export function hasValidTokens(): boolean {
    const tokens = readTokens()
    return tokens !== null && tokens.deviceToken.length > 0
}
