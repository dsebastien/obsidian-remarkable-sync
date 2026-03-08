import { test, expect, describe } from 'bun:test'
import { resolveCloudUrls, validateRmfakecloudUrl } from './cloud-urls'
import { DEFAULT_SETTINGS } from '../../types/plugin-settings.intf'

describe('resolveCloudUrls', () => {
    test('returns official URLs by default', () => {
        const urls = resolveCloudUrls(DEFAULT_SETTINGS)
        expect(urls.isRmfakecloud).toBe(false)
        expect(urls.authBaseUrl).toBe('https://webapp-prod.cloud.remarkable.engineering')
        expect(urls.syncBaseUrl).toBe('https://internal.cloud.remarkable.com')
        expect(urls.deviceTokenUrl).toBe(
            'https://webapp-prod.cloud.remarkable.engineering/token/json/2/device/new'
        )
        expect(urls.userTokenUrl).toBe(
            'https://webapp-prod.cloud.remarkable.engineering/token/json/2/user/new'
        )
    })

    test('returns rmfakecloud URLs when enabled with a URL', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            useRmfakecloud: true,
            rmfakecloudUrl: 'https://mycloud.example.com'
        }
        const urls = resolveCloudUrls(settings)
        expect(urls.isRmfakecloud).toBe(true)
        expect(urls.authBaseUrl).toBe('https://mycloud.example.com')
        expect(urls.syncBaseUrl).toBe('https://mycloud.example.com')
        expect(urls.deviceTokenUrl).toBe('https://mycloud.example.com/token/json/2/device/new')
        expect(urls.userTokenUrl).toBe('https://mycloud.example.com/token/json/2/user/new')
    })

    test('strips trailing slashes from rmfakecloud URL', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            useRmfakecloud: true,
            rmfakecloudUrl: 'https://mycloud.example.com///'
        }
        const urls = resolveCloudUrls(settings)
        expect(urls.syncBaseUrl).toBe('https://mycloud.example.com')
        expect(urls.authBaseUrl).toBe('https://mycloud.example.com')
    })

    test('falls back to official when rmfakecloud enabled but URL is empty', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            useRmfakecloud: true,
            rmfakecloudUrl: ''
        }
        const urls = resolveCloudUrls(settings)
        expect(urls.isRmfakecloud).toBe(false)
        expect(urls.authBaseUrl).toBe('https://webapp-prod.cloud.remarkable.engineering')
    })

    test('falls back to official when rmfakecloud is disabled', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            useRmfakecloud: false,
            rmfakecloudUrl: 'https://mycloud.example.com'
        }
        const urls = resolveCloudUrls(settings)
        expect(urls.isRmfakecloud).toBe(false)
        expect(urls.authBaseUrl).toBe('https://webapp-prod.cloud.remarkable.engineering')
    })

    test('handles URL with port number', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            useRmfakecloud: true,
            rmfakecloudUrl: 'http://localhost:3000'
        }
        const urls = resolveCloudUrls(settings)
        expect(urls.isRmfakecloud).toBe(true)
        expect(urls.syncBaseUrl).toBe('http://localhost:3000')
        expect(urls.deviceTokenUrl).toBe('http://localhost:3000/token/json/2/device/new')
    })
})

describe('validateRmfakecloudUrl', () => {
    test('returns null for valid https URL', () => {
        expect(validateRmfakecloudUrl('https://cloud.example.com')).toBeNull()
    })

    test('returns null for valid http URL', () => {
        expect(validateRmfakecloudUrl('http://localhost:3000')).toBeNull()
    })

    test('returns null for URL with path', () => {
        expect(validateRmfakecloudUrl('https://example.com/rmfakecloud')).toBeNull()
    })

    test('returns error for empty URL', () => {
        expect(validateRmfakecloudUrl('')).toBeTruthy()
    })

    test('returns error for whitespace-only URL', () => {
        expect(validateRmfakecloudUrl('   ')).toBeTruthy()
    })

    test('returns error for invalid URL', () => {
        expect(validateRmfakecloudUrl('not-a-url')).toBeTruthy()
    })

    test('returns error for non-http protocol', () => {
        expect(validateRmfakecloudUrl('ftp://example.com')).toBeTruthy()
    })
})
