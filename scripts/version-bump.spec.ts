import { describe, expect, test } from 'bun:test'
import type { ManifestJson, VersionsJson } from './version-bump'

describe('ManifestJson interface', () => {
    test('valid manifest structure', () => {
        const manifest: ManifestJson = {
            id: 'test-plugin',
            name: 'Test Plugin',
            version: '1.0.0',
            minAppVersion: '1.4.0'
        }

        expect(manifest.id).toBe('test-plugin')
        expect(manifest.name).toBe('Test Plugin')
        expect(manifest.version).toBe('1.0.0')
        expect(manifest.minAppVersion).toBe('1.4.0')
    })

    test('manifest allows additional properties', () => {
        const manifest: ManifestJson = {
            id: 'test-plugin',
            name: 'Test Plugin',
            version: '1.0.0',
            minAppVersion: '1.4.0',
            author: 'Test Author',
            description: 'A test plugin'
        }

        expect(manifest.author).toBe('Test Author')
        expect(manifest.description).toBe('A test plugin')
    })
})

describe('VersionsJson interface', () => {
    test('valid versions structure', () => {
        const versions: VersionsJson = {
            '1.0.0': '0.15.0',
            '1.1.0': '1.0.0'
        }

        expect(versions['1.0.0']).toBe('0.15.0')
        expect(versions['1.1.0']).toBe('1.0.0')
    })

    test('versions keys should be semver', () => {
        const versions: VersionsJson = {
            '1.0.0': '0.15.0'
        }

        const key = Object.keys(versions)[0]
        expect(key).toMatch(/^\d+\.\d+\.\d+$/)
    })

    test('versions values should be semver', () => {
        const versions: VersionsJson = {
            '1.0.0': '0.15.0'
        }

        const value = Object.values(versions)[0]
        expect(value).toMatch(/^\d+\.\d+\.\d+$/)
    })
})

describe('version format validation', () => {
    test('valid semver formats', () => {
        const validVersions = ['0.0.1', '1.0.0', '1.2.3', '10.20.30']
        const semverRegex = /^\d+\.\d+\.\d+$/

        for (const version of validVersions) {
            expect(version).toMatch(semverRegex)
        }
    })

    test('invalid semver formats', () => {
        const invalidVersions = ['1.0', '1', 'v1.0.0', '1.0.0-beta', '1.0.0.0']
        const semverRegex = /^\d+\.\d+\.\d+$/

        for (const version of invalidVersions) {
            expect(version).not.toMatch(semverRegex)
        }
    })
})

describe('latestMinAppVersion', () => {
    test('returns the floor of the highest release, not the last key', async () => {
        const { latestMinAppVersion } = await import('./version-bump')
        expect(latestMinAppVersion({ '1.6.0': '1.13.0', '0.1.0': '1.4.0', '1.8.0': '1.8.7' })).toBe(
            '1.8.7'
        )
    })

    test('compares versions numerically, not lexicographically', async () => {
        const { latestMinAppVersion } = await import('./version-bump')
        expect(latestMinAppVersion({ '9.0.0': '1.4.0', '10.0.0': '1.13.0' })).toBe('1.13.0')
    })

    test('returns null for an empty file', async () => {
        const { latestMinAppVersion } = await import('./version-bump')
        expect(latestMinAppVersion({})).toBe(null)
    })

    test('a floor that regressed and returns must still produce a new boundary', async () => {
        const { latestMinAppVersion } = await import('./version-bump')
        // This repo's real history: 1.13.0 appears at 1.6.0, then the floor
        // dropped to 1.8.7. A membership check would say 1.13.0 is "already
        // tracked"; the latest-floor comparison correctly reports 1.8.7, so a
        // new 1.13.0 boundary gets recorded.
        const versions = { '0.1.0': '1.4.0', '1.3.6': '1.7.2', '1.6.0': '1.13.0', '1.8.0': '1.8.7' }
        expect(latestMinAppVersion(versions)).not.toBe('1.13.0')
    })
})
