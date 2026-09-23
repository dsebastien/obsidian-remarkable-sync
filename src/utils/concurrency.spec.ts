import { describe, expect, test } from 'bun:test'
import { mapSettledWithConcurrency } from './concurrency'

describe('mapSettledWithConcurrency', () => {
    test('never has more than `limit` calls in flight', async () => {
        let inFlight = 0
        let peak = 0
        const items = Array.from({ length: 25 }, (_, i) => i)

        await mapSettledWithConcurrency(items, 4, async (item) => {
            inFlight++
            peak = Math.max(peak, inFlight)
            await new Promise((resolve) => setTimeout(resolve, item % 3))
            inFlight--
            return item
        })

        expect(peak).toBe(4)
    })

    test('keeps input order and settles rejections without stopping the rest', async () => {
        const results = await mapSettledWithConcurrency([1, 2, 3, 4], 2, async (item) => {
            await new Promise((resolve) => setTimeout(resolve, 5 - item))
            if (item === 2) throw new Error('boom')
            return item * 10
        })

        expect(results.map((r) => r.status)).toEqual([
            'fulfilled',
            'rejected',
            'fulfilled',
            'fulfilled'
        ])
        expect(results[0]).toEqual({ status: 'fulfilled', value: 10 })
        expect(results[3]).toEqual({ status: 'fulfilled', value: 40 })
    })

    test('handles an empty list and a nonsensical limit', async () => {
        expect(await mapSettledWithConcurrency([], 4, async () => 1)).toEqual([])
        const results = await mapSettledWithConcurrency([1, 2], 0, async (x) => x)
        expect(results).toEqual([
            { status: 'fulfilled', value: 1 },
            { status: 'fulfilled', value: 2 }
        ])
    })
})
