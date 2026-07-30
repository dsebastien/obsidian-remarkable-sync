import { test, expect, describe } from 'bun:test'
import { createWriteQueue, mergePluginData } from './plugin-data'

describe('createWriteQueue', () => {
    test('runs tasks one at a time, in order', async () => {
        const enqueue = createWriteQueue()
        const events: string[] = []
        const task = (name: string, delayMs: number) => async (): Promise<void> => {
            events.push(`${name}:start`)
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            events.push(`${name}:end`)
        }

        await Promise.all([enqueue(task('a', 10)), enqueue(task('b', 0))])

        expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
    })

    test('a failing task rejects only its own caller', async () => {
        const enqueue = createWriteQueue()

        expect(enqueue(() => Promise.reject(new Error('disk full')))).rejects.toThrow('disk full')

        // The regression this exists for: chaining on the fulfilled path alone
        // leaves the queue rejected forever, so every later write is skipped.
        let ran = false
        await enqueue(async () => {
            ran = true
            await Promise.resolve()
        })
        expect(ran).toBe(true)
    })

    test('keeps running after several consecutive failures', async () => {
        const enqueue = createWriteQueue()
        const fail = (): Promise<void> => Promise.reject(new Error('nope'))

        expect(enqueue(fail)).rejects.toThrow('nope')
        expect(enqueue(fail)).rejects.toThrow('nope')

        const order: number[] = []
        await enqueue(async () => {
            order.push(1)
            await Promise.resolve()
        })
        await enqueue(async () => {
            order.push(2)
            await Promise.resolve()
        })
        expect(order).toEqual([1, 2])
    })
})

describe('mergePluginData', () => {
    test('adds new entries', () => {
        expect(mergePluginData({}, { targetFolder: 'rM' })).toEqual({ targetFolder: 'rM' })
    })

    test('overwrites existing entries', () => {
        expect(mergePluginData({ targetFolder: 'old' }, { targetFolder: 'new' })).toEqual({
            targetFolder: 'new'
        })
    })

    test('preserves entries the patch does not mention', () => {
        // The regression this exists for: saving settings must not drop tokens.
        const current = { targetFolder: 'rM', tokens: { deviceToken: 'abc' } }
        expect(mergePluginData(current, { targetFolder: 'notes', saveImages: true })).toEqual({
            targetFolder: 'notes',
            saveImages: true,
            tokens: { deviceToken: 'abc' }
        })
    })

    test('removes keys patched with undefined or null', () => {
        const current = { tokens: { deviceToken: 'abc' }, other: 1 }
        expect(mergePluginData(current, { tokens: undefined })).toEqual({ other: 1 })
        expect(mergePluginData(current, { tokens: null })).toEqual({ other: 1 })
    })

    test('does not mutate its inputs', () => {
        const current = { a: 1 }
        const patch = { b: 2 }
        mergePluginData(current, patch)
        expect(current).toEqual({ a: 1 })
        expect(patch).toEqual({ b: 2 })
    })

    test('keeps falsy values that are not undefined or null', () => {
        expect(mergePluginData({}, { saveImages: false, imageQuality: 0, folder: '' })).toEqual({
            saveImages: false,
            imageQuality: 0,
            folder: ''
        })
    })
})
