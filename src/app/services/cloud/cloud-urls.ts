import type { PluginSettings } from '../../types/plugin-settings.intf'

// Official reMarkable cloud URLs
const OFFICIAL_AUTH_BASE = 'https://webapp-prod.cloud.remarkable.engineering'
const OFFICIAL_SYNC_BASE = 'https://internal.cloud.remarkable.com'

export interface CloudUrls {
    readonly authBaseUrl: string
    readonly syncBaseUrl: string
    readonly deviceTokenUrl: string
    readonly userTokenUrl: string
    readonly isRmfakecloud: boolean
}

/**
 * Resolve cloud URLs based on plugin settings.
 * rmfakecloud serves all endpoints from a single host.
 * Official cloud uses separate hosts for auth and sync.
 */
export function resolveCloudUrls(settings: PluginSettings): CloudUrls {
    if (settings.useRmfakecloud && settings.rmfakecloudUrl) {
        const base = settings.rmfakecloudUrl.replace(/\/+$/, '')
        return {
            authBaseUrl: base,
            syncBaseUrl: base,
            deviceTokenUrl: `${base}/token/json/2/device/new`,
            userTokenUrl: `${base}/token/json/2/user/new`,
            isRmfakecloud: true
        }
    }

    return {
        authBaseUrl: OFFICIAL_AUTH_BASE,
        syncBaseUrl: OFFICIAL_SYNC_BASE,
        deviceTokenUrl: `${OFFICIAL_AUTH_BASE}/token/json/2/device/new`,
        userTokenUrl: `${OFFICIAL_AUTH_BASE}/token/json/2/user/new`,
        isRmfakecloud: false
    }
}

/**
 * Validate an rmfakecloud URL. Returns an error message or null if valid.
 */
export function validateRmfakecloudUrl(url: string): string | null {
    if (!url.trim()) {
        return 'Server URL is required when rmfakecloud is enabled'
    }
    try {
        const parsed = new URL(url.trim())
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return 'URL must use http:// or https://'
        }
        return null
    } catch {
        return 'Invalid URL format'
    }
}
