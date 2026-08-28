/**
 * Updates manifest.json and versions.json with the target version.
 * The target version is read from npm_package_version environment variable.
 * Usage: npm_package_version=1.2.3 bun scripts/version-bump.ts
 */

import { file } from 'bun'

export interface ManifestJson {
    id: string
    name: string
    version: string
    minAppVersion: string
    [key: string]: unknown
}

export interface VersionsJson {
    [version: string]: string
}

export async function readManifest(): Promise<ManifestJson> {
    const manifestFile = file('manifest.json')
    return (await manifestFile.json()) as ManifestJson
}

export async function writeManifest(manifest: ManifestJson): Promise<void> {
    const manifestFile = file('manifest.json')
    await Bun.write(manifestFile, JSON.stringify(manifest, null, 4) + '\n')
}

export async function readVersions(): Promise<VersionsJson> {
    const versionsFile = file('versions.json')
    return (await versionsFile.json()) as VersionsJson
}

export async function writeVersions(versions: VersionsJson): Promise<void> {
    const versionsFile = file('versions.json')
    await Bun.write(versionsFile, JSON.stringify(versions, null, 4) + '\n')
}

/**
 * The minAppVersion of the most recent release recorded in versions.json,
 * or null for an empty file. "Most recent" is the highest plugin version by
 * numeric semver comparison — object order is not trustworthy after manual
 * edits.
 */
export function latestMinAppVersion(versions: VersionsJson): string | null {
    let latest: string | null = null
    for (const version of Object.keys(versions)) {
        if (latest === null || compareVersions(version, latest) > 0) {
            latest = version
        }
    }
    return latest === null ? null : (versions[latest] ?? null)
}

function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
        if (diff !== 0) {
            return diff
        }
    }
    return 0
}

export async function bumpVersion(targetVersion: string): Promise<void> {
    // Read and update manifest.json
    const manifest = await readManifest()
    const { minAppVersion } = manifest
    manifest.version = targetVersion
    await writeManifest(manifest)
    console.log(`Updated manifest.json version to ${targetVersion}`)

    // Record a new compatibility boundary whenever the floor CHANGED since
    // the latest recorded release. A membership check is wrong here: this
    // repo's floor went 1.13.0 -> 1.8.7 -> 1.13.0, and "1.13.0 appears
    // somewhere in the file" would skip the new boundary — older Obsidian
    // versions would then be offered a release whose APIs they lack.
    const versions = await readVersions()
    if (latestMinAppVersion(versions) !== minAppVersion) {
        versions[targetVersion] = minAppVersion
        await writeVersions(versions)
        console.log(`Added ${targetVersion} -> ${minAppVersion} to versions.json`)
    } else {
        console.log(`versions.json floor is already ${minAppVersion}`)
    }
}

// Only run if executed directly
if (import.meta.main) {
    const targetVersion = Bun.env['npm_package_version']

    if (!targetVersion) {
        console.error('Error: npm_package_version environment variable is not set.')
        console.error('Usage: npm_package_version=1.2.3 bun scripts/version-bump.ts')
        process.exit(1)
    }

    await bumpVersion(targetVersion)
}
