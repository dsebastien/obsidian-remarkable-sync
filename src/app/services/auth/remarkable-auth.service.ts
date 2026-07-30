import { requestUrl } from 'obsidian'
import { log } from '../../../utils/log'
import { createTokenStoreForPlugin } from './token-store'
import type { TokenStore } from './token-store'
import { resolveCloudUrls } from '../cloud/cloud-urls'
import { generateUuidV4 } from '../../../utils/uuid'
import type { RemarkableSyncPlugin } from '../../plugin'

// Device registration uses a fixed device description
const DEVICE_DESC = 'desktop-windows'

/**
 * Generated on first use rather than at module load: this file is imported
 * during `onload`, and a throw there stops the plugin from loading at all.
 */
let deviceId: string | null = null
function getDeviceId(): string {
    deviceId ??= generateUuidV4()
    return deviceId
}

export interface RemarkableAuthService {
    registerDevice(oneTimeCode: string): Promise<boolean>
    getUserToken(): Promise<string | null>
    refreshAndGetUserToken(): Promise<string | null>
    isAuthenticated(): Promise<boolean>
    disconnect(): Promise<void>
}

/**
 * @param tokenStore injectable for tests; defaults to the plugin's `data.json`
 * backed store.
 */
export function createRemarkableAuthService(
    plugin: RemarkableSyncPlugin,
    tokenStore: TokenStore = createTokenStoreForPlugin(plugin)
): RemarkableAuthService {
    let cachedUserToken: string | null = null
    let tokenExpiryTime = 0
    /**
     * Bumped on every disconnect. Token refreshes capture it before awaiting
     * the network and drop their result if it changed — otherwise a refresh
     * still in flight when the user disconnects would write the tokens back and
     * silently reconnect the vault.
     */
    let authGeneration = 0

    /**
     * Whether a disconnect happened since `generation` was captured. Callers
     * capture it on entry and re-check after every await that precedes a
     * mutation of the cache or the store.
     */
    function isStale(generation: number): boolean {
        if (generation === authGeneration) {
            return false
        }
        log('Discarding an authentication result that finished after a disconnect', 'debug')
        return true
    }

    /**
     * Persist tokens unless a disconnect landed first. The store write and a
     * concurrent `clear()` are both queued on the same `data.json` writer, so a
     * disconnect that lands mid-write is undone here rather than resurrecting
     * the credentials.
     */
    async function writeTokensUnlessDisconnected(
        generation: number,
        tokens: { deviceToken: string; userToken: string; userTokenExpiry: number }
    ): Promise<boolean> {
        if (isStale(generation)) {
            return false
        }
        await tokenStore.write(tokens)
        if (isStale(generation)) {
            await tokenStore.clear()
            return false
        }
        cachedUserToken = tokens.userToken
        tokenExpiryTime = tokens.userTokenExpiry
        return true
    }

    async function registerDevice(oneTimeCode: string): Promise<boolean> {
        const generation = authGeneration
        try {
            const urls = resolveCloudUrls(plugin.settings)
            log(
                `Registering device with ${urls.isRmfakecloud ? 'rmfakecloud' : 'reMarkable cloud'}`,
                'debug'
            )
            const response = await requestUrl({
                url: urls.deviceTokenUrl,
                method: 'POST',
                contentType: 'application/json',
                body: JSON.stringify({
                    code: oneTimeCode,
                    deviceDesc: DEVICE_DESC,
                    deviceID: getDeviceId()
                })
            })

            if (response.status !== 200) {
                log(`Device registration failed with status ${response.status}`, 'error')
                return false
            }

            const deviceToken = response.text
            if (!deviceToken) {
                log('No device token received', 'error')
                return false
            }

            // Exchange device token for user token
            const userTokenResult = await refreshUserToken(deviceToken)
            if (!userTokenResult) {
                return false
            }

            const saved = await writeTokensUnlessDisconnected(generation, {
                deviceToken,
                userToken: userTokenResult.token,
                userTokenExpiry: userTokenResult.expiry
            })
            if (!saved) {
                return false
            }

            log('Device registered successfully', 'info')
            return true
        } catch (error) {
            log('Device registration failed', 'error', error)
            return false
        }
    }

    async function refreshUserToken(
        deviceToken: string
    ): Promise<{ token: string; expiry: number } | null> {
        try {
            const urls = resolveCloudUrls(plugin.settings)
            const response = await requestUrl({
                url: urls.userTokenUrl,
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${deviceToken}`
                }
            })

            if (response.status !== 200) {
                log(`User token refresh failed with status ${response.status}`, 'error')
                return null
            }

            const userToken = response.text
            if (!userToken) {
                log('No user token received', 'error')
                return null
            }

            // User tokens expire in 24 hours, refresh after 23h
            const expiry = Date.now() + 23 * 60 * 60 * 1000

            return { token: userToken, expiry }
        } catch (error) {
            log('User token refresh failed', 'error', error)
            return null
        }
    }

    async function getUserToken(): Promise<string | null> {
        // Return cached token if still valid
        if (cachedUserToken && Date.now() < tokenExpiryTime) {
            return cachedUserToken
        }

        const generation = authGeneration

        // Try to load from stored tokens
        const stored = await tokenStore.read()
        if (!stored || isStale(generation)) {
            return null
        }

        // Check if user token is still valid
        if (Date.now() < stored.userTokenExpiry) {
            cachedUserToken = stored.userToken
            tokenExpiryTime = stored.userTokenExpiry
            return cachedUserToken
        }

        // Token expired, refresh using device token
        const result = await refreshUserToken(stored.deviceToken)
        if (!result) {
            return null
        }

        const saved = await writeTokensUnlessDisconnected(generation, {
            deviceToken: stored.deviceToken,
            userToken: result.token,
            userTokenExpiry: result.expiry
        })
        return saved ? cachedUserToken : null
    }

    async function refreshAndGetUserToken(): Promise<string | null> {
        const generation = authGeneration

        const stored = await tokenStore.read()
        if (!stored || isStale(generation)) {
            return null
        }

        const result = await refreshUserToken(stored.deviceToken)
        if (!result) {
            return null
        }

        const saved = await writeTokensUnlessDisconnected(generation, {
            deviceToken: stored.deviceToken,
            userToken: result.token,
            userTokenExpiry: result.expiry
        })
        if (!saved) {
            return null
        }

        log('User token force-refreshed', 'debug')
        return cachedUserToken
    }

    async function isAuthenticated(): Promise<boolean> {
        return tokenStore.hasValid()
    }

    async function disconnect(): Promise<void> {
        authGeneration++
        cachedUserToken = null
        tokenExpiryTime = 0
        await tokenStore.clear()
        log('Disconnected from reMarkable cloud', 'info')
    }

    return {
        registerDevice,
        getUserToken,
        refreshAndGetUserToken,
        isAuthenticated,
        disconnect
    }
}
