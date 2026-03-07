import { requestUrl } from 'obsidian'
import type { Plugin } from 'obsidian'
import { log } from '../../../utils/log'
import { readTokens, writeTokens, deleteTokens, hasValidTokens } from './token-store'

const AUTH_BASE_URL = 'https://webapp-prod.cloud.remarkable.engineering'
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/token/json/2/device/new`
const USER_TOKEN_URL = `${AUTH_BASE_URL}/token/json/2/user/new`

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

export function createRemarkableAuthService(_plugin: Plugin): RemarkableAuthService {
    let cachedUserToken: string | null = null
    let tokenExpiryTime = 0

    async function registerDevice(oneTimeCode: string): Promise<boolean> {
        try {
            log('Registering device with reMarkable cloud', 'debug')
            const response = await requestUrl({
                url: DEVICE_TOKEN_URL,
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
            const response = await requestUrl({
                url: USER_TOKEN_URL,
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
