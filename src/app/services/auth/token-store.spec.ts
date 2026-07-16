import { test, expect, describe } from 'bun:test'
import { parseStoredTokens } from './token-store'

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
