import { requestUrl } from 'obsidian'
import { log } from '../../../utils/log'
import { createTokenStoreForPlugin } from './token-store'
import type { CredentialState, TokenStore } from './token-store'
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

/**
 * Why no user token could be had. Only `not-connected` and `rejected` need
 * the user to reconnect; `unreachable` (offline, a 5xx, a 429 from the token
 * endpoint) passes on its own, and telling an offline user to re-register
 * would push them into a pointless reconnect every day.
 */
export type TokenFailure = 'not-connected' | 'rejected' | 'unreachable'

export type TokenOutcome = { readonly token: string } | { readonly failure: TokenFailure }

export interface RemarkableAuthService {
    registerDevice(oneTimeCode: string): Promise<boolean>
    getUserToken(): Promise<string | null>
    refreshAndGetUserToken(): Promise<string | null>
    /** `getUserToken`, saying why when there is none. */
    acquireUserToken(): Promise<TokenOutcome>
    /** `refreshAndGetUserToken`, saying why when there is none. */
    forceRefreshUserToken(): Promise<TokenOutcome>
    isAuthenticated(): Promise<boolean>
    /** Whether a device token is available here, or why not. */
    credentialState(): Promise<CredentialState>
    /** Read the device token from another secret (picked in the settings). */
    useDeviceTokenSecret(name: string): Promise<void>
    disconnect(): Promise<void>
}

/**
 * Why the token endpoint gave no token. Only a transient answer (408, 429, a
 * 5xx) means the cloud could not be reached; every other 4xx, including a 400
 * for a malformed or revoked device token, is a refusal no retry will change,
 * so the user is told to reconnect instead of to try again later.
 */
export function failureForStatus(status: number): TokenFailure {
    return status === 408 || status === 429 || status >= 500 ? 'unreachable' : 'rejected'
}

/**
 * @param tokenStore injectable for tests; defaults to the plugin's `data.json`
 * backed store.
 * @param request injectable for tests; defaults to Obsidian's `requestUrl`.
 */
export function createRemarkableAuthService(
    plugin: RemarkableSyncPlugin,
    tokenStore: TokenStore = createTokenStoreForPlugin(plugin),
    request: typeof requestUrl = requestUrl
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
     * Persist the device token unless a disconnect landed first. The store
     * write and a concurrent `clear()` both go through the same `data.json`
     * writer, so a disconnect that lands mid-write is undone here rather than
     * resurrecting the credentials.
     */
    async function writeTokensUnlessDisconnected(
        generation: number,
        deviceToken: string
    ): Promise<boolean> {
        if (isStale(generation)) {
            return false
        }
        await tokenStore.write(deviceToken)
        if (isStale(generation)) {
            await tokenStore.clear()
            return false
        }
        return true
    }

    /**
     * Cache a user token in memory, unless a disconnect landed first. User
     * tokens are never persisted: they are short-lived and regenerated from
     * the device token.
     */
    function cacheUnlessDisconnected(
        generation: number,
        result: { token: string; expiry: number }
    ): boolean {
        if (isStale(generation)) {
            return false
        }
        cachedUserToken = result.token
        tokenExpiryTime = result.expiry
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
            if ('failure' in userTokenResult) {
                return false
            }

            const saved = await writeTokensUnlessDisconnected(generation, deviceToken)
            if (!saved || !cacheUnlessDisconnected(generation, userTokenResult)) {
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
    ): Promise<{ token: string; expiry: number } | { failure: TokenFailure }> {
        try {
            const urls = resolveCloudUrls(plugin.settings)
            const response = await request({
                url: urls.userTokenUrl,
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${deviceToken}`
                }
            })

            if (response.status !== 200) {
                log(`User token refresh failed with status ${response.status}`, 'error')
                return { failure: failureForStatus(response.status) }
            }

            const userToken = response.text
            if (!userToken) {
                log('No user token received', 'error')
                return { failure: 'unreachable' }
            }

            // User tokens expire in 24 hours, refresh after 23h
            const expiry = Date.now() + 23 * 60 * 60 * 1000

            return { token: userToken, expiry }
        } catch (error) {
            log('User token refresh failed', 'error', error)
            const status =
                error && typeof error === 'object' && 'status' in error
                    ? Number(error.status)
                    : undefined
            return { failure: status === undefined ? 'unreachable' : failureForStatus(status) }
        }
    }

    async function acquireUserToken(): Promise<TokenOutcome> {
        // Return cached token if still valid
        if (cachedUserToken && Date.now() < tokenExpiryTime) {
            return { token: cachedUserToken }
        }

        const generation = authGeneration

        // No valid user token in memory: derive one from the device token
        const deviceToken = await tokenStore.read()
        if (!deviceToken || isStale(generation)) {
            return { failure: 'not-connected' }
        }

        return renewWith(generation, deviceToken)
    }

    async function forceRefreshUserToken(): Promise<TokenOutcome> {
        const generation = authGeneration

        const deviceToken = await tokenStore.read()
        if (!deviceToken || isStale(generation)) {
            return { failure: 'not-connected' }
        }

        const outcome = await renewWith(generation, deviceToken)
        if ('token' in outcome) {
            log('User token force-refreshed', 'debug')
        }
        return outcome
    }

    async function renewWith(generation: number, deviceToken: string): Promise<TokenOutcome> {
        const result = await refreshUserToken(deviceToken)
        if ('failure' in result) {
            return result
        }

        return cacheUnlessDisconnected(generation, result)
            ? { token: result.token }
            : { failure: 'not-connected' }
    }

    async function getUserToken(): Promise<string | null> {
        const outcome = await acquireUserToken()
        return 'token' in outcome ? outcome.token : null
    }

    async function refreshAndGetUserToken(): Promise<string | null> {
        const outcome = await forceRefreshUserToken()
        return 'token' in outcome ? outcome.token : null
    }

    async function isAuthenticated(): Promise<boolean> {
        return tokenStore.hasValid()
    }

    async function credentialState(): Promise<CredentialState> {
        return tokenStore.state()
    }

    async function useDeviceTokenSecret(name: string): Promise<void> {
        // A user token derived from the previous secret must not outlive it,
        // nor may a refresh in flight write it back.
        authGeneration++
        cachedUserToken = null
        tokenExpiryTime = 0
        await tokenStore.changeSecretName(name)
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
        acquireUserToken,
        forceRefreshUserToken,
        isAuthenticated,
        credentialState,
        useDeviceTokenSecret,
        disconnect
    }
}
