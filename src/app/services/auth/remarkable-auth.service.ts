import { requestUrl } from 'obsidian'
import { log } from '../../../utils/log'
import { readTokens, writeTokens, deleteTokens, hasValidTokens } from './token-store'
import { resolveCloudUrls } from '../cloud/cloud-urls'
import type { RemarkableSyncPlugin } from '../../plugin'

// Device registration uses a fixed device description
const DEVICE_DESC = 'desktop-windows'
const DEVICE_ID = crypto.randomUUID()

export interface RemarkableAuthService {
    registerDevice(oneTimeCode: string): Promise<boolean>
    getUserToken(): Promise<string | null>
    refreshAndGetUserToken(): Promise<string | null>
    isAuthenticated(): Promise<boolean>
    disconnect(): Promise<void>
}

export function createRemarkableAuthService(plugin: RemarkableSyncPlugin): RemarkableAuthService {
    let cachedUserToken: string | null = null
    let tokenExpiryTime = 0

    async function registerDevice(oneTimeCode: string): Promise<boolean> {
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
                    deviceID: DEVICE_ID
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

            writeTokens({
                deviceToken,
                userToken: userTokenResult.token,
                userTokenExpiry: userTokenResult.expiry
            })

            cachedUserToken = userTokenResult.token
            tokenExpiryTime = userTokenResult.expiry

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

        // Try to load from stored tokens
        const stored = readTokens()
        if (!stored) {
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

        cachedUserToken = result.token
        tokenExpiryTime = result.expiry

        writeTokens({
            deviceToken: stored.deviceToken,
            userToken: result.token,
            userTokenExpiry: result.expiry
        })

        return cachedUserToken
    }

    async function refreshAndGetUserToken(): Promise<string | null> {
        const stored = readTokens()
        if (!stored) {
            return null
        }

        const result = await refreshUserToken(stored.deviceToken)
        if (!result) {
            return null
        }

        cachedUserToken = result.token
        tokenExpiryTime = result.expiry

        writeTokens({
            deviceToken: stored.deviceToken,
            userToken: result.token,
            userTokenExpiry: result.expiry
        })

        log('User token force-refreshed', 'debug')
        return cachedUserToken
    }

    async function isAuthenticated(): Promise<boolean> {
        return hasValidTokens()
    }

    async function disconnect(): Promise<void> {
        cachedUserToken = null
        tokenExpiryTime = 0
        deleteTokens()
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
