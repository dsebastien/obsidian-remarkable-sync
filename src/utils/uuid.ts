/**
 * Generate a RFC 4122 version 4 UUID.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts. Obsidian's mobile
 * webview is not guaranteed to qualify, and the device id is needed at plugin
 * load — an unguarded call there would throw and stop the plugin from loading
 * at all. Falls back to `crypto.getRandomValues`, then to `Math.random`.
 *
 * Used for the reMarkable device identifier, not for anything security
 * sensitive, so the weakest fallback is still acceptable.
 */
export function generateUuidV4(): string {
    // `in` rather than reading the property: detaching the method trips
    // @typescript-eslint/unbound-method.
    const webCrypto = globalThis.crypto as Crypto | undefined
    if (webCrypto && 'randomUUID' in webCrypto) {
        return webCrypto.randomUUID()
    }

    const bytes = randomBytes(16)
    // Version 4, variant 1 (RFC 4122 §4.4).
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

    const hex: string[] = []
    for (const byte of bytes) {
        hex.push(byte.toString(16).padStart(2, '0'))
    }
    return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join('')
    ].join('-')
}

function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    const webCrypto = globalThis.crypto as Crypto | undefined
    if (webCrypto && 'getRandomValues' in webCrypto) {
        webCrypto.getRandomValues(bytes)
        return bytes
    }
    for (let i = 0; i < length; i++) {
        bytes[i] = Math.floor(Math.random() * 256)
    }
    return bytes
}
