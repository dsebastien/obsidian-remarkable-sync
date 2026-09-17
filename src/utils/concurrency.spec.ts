import { describe, expect, test } from 'bun:test'
import { mapWithConcurrency } from './concurrency'

/** Await a promise that must reject, and hand back what it rejected with. */
async function rejection(run: Promise<unknown>): Promise<unknown> {
    try {
        await run
    } catch (error) {
        return error
    }
    throw new Error('expected the promise to reject')
}

function deferred<T>(): {
    promise: Promise<T>
    resolve: (v: T) => void
    reject: (e: unknown) => void
} {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

describe('mapWithConcurrency', () => {
    test('returns results in input order', async () => {
        const out = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
            await new Promise((r) => setTimeout(r, n))
            return n * 10
        })
        expect(out).toEqual([30, 10, 20])
    })

    test('never has more than `limit` workers in flight', async () => {
        let inFlight = 0
        let peak = 0
        const items = Array.from({ length: 20 }, (_, i) => i)
        await mapWithConcurrency(items, 4, async () => {
            inFlight++
            peak = Math.max(peak, inFlight)
            await new Promise((r) => setTimeout(r, 1))
            inFlight--
        })
        expect(peak).toBe(4)
    })

    test('handles an empty input', async () => {
        const out = await mapWithConcurrency([], 4, async () => 1)
        expect(out).toEqual([])
    })

    test('rejects a non-positive limit', async () => {
        const error = await rejection(mapWithConcurrency([1], 0, async (n) => n))
        expect(error).toBeInstanceOf(RangeError)
    })

    test('the first failure stops new work from starting and is rethrown', async () => {
        const started: number[] = []
        const gate = deferred<void>()
        const items = Array.from({ length: 10 }, (_, i) => i)

        const run = mapWithConcurrency(items, 2, async (n) => {
            started.push(n)
            if (n === 0) {
                throw new Error('boom')
            }
            await gate.promise
            return n
        })

        // Item 0 fails immediately; item 1 is in flight behind the gate.
        // Nothing beyond the two lanes must have been started.
        await new Promise((r) => setTimeout(r, 5))
        expect(started).toEqual([0, 1])

        gate.resolve()
        expect((await rejection(run)) as Error).toHaveProperty('message', 'boom')
        expect(started).toEqual([0, 1])
    })

    test('reports the first error, not the last', async () => {
        const run = mapWithConcurrency([1, 2], 1, async (n) => {
            throw new Error(`fail-${n}`)
        })
        expect((await rejection(run)) as Error).toHaveProperty('message', 'fail-1')
    })
})
