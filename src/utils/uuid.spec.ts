import { test, expect, describe, afterEach } from 'bun:test'
import { generateUuidV4 } from './uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Swap in a `crypto` that lacks the given capabilities, mimicking a webview
 * that is not a secure context.
 */
function withCrypto(replacement: unknown, run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', {
        value: replacement,
        configurable: true,
        writable: true
    })
    try {
        run()
    } finally {
        if (original) {
            Object.defineProperty(globalThis, 'crypto', original)
        }
    }
}

describe('generateUuidV4', () => {
    afterEach(() => {
        // Guard against a failing test leaving a patched global behind.
        expect(typeof globalThis.crypto).toBe('object')
    })

    test('produces a valid v4 uuid', () => {
        expect(generateUuidV4()).toMatch(UUID_V4)
    })

    test('produces distinct values', () => {
        const values = new Set(Array.from({ length: 50 }, () => generateUuidV4()))
        expect(values.size).toBe(50)
    })

    test('falls back to getRandomValues when randomUUID is missing', () => {
        withCrypto(
            {
                getRandomValues: (bytes: Uint8Array) => {
                    bytes.fill(0xab)
                    return bytes
                }
            },
            () => {
                const uuid = generateUuidV4()
                expect(uuid).toMatch(UUID_V4)
                // Version and variant bits are forced regardless of the source.
                expect(uuid[14]).toBe('4')
                expect('89ab').toContain(uuid[19] ?? '')
            }
        )
    })

    test('falls back to Math.random when crypto is unavailable entirely', () => {
        withCrypto(undefined, () => {
            expect(generateUuidV4()).toMatch(UUID_V4)
        })
    })

    test('does not throw when crypto exists but is empty', () => {
        withCrypto({}, () => {
            expect(generateUuidV4()).toMatch(UUID_V4)
        })
    })
})
