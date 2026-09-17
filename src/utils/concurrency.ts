/**
 * Map `items` through `worker` with at most `limit` calls in flight.
 *
 * Results come back in input order. The first rejection aborts the run: no
 * new work is started, the in-flight calls are left to settle on their own,
 * and that first error is rethrown. This is what a cloud listing wants — one
 * entry that cannot be fetched already makes the listing incomplete, so
 * hammering the server with the remaining hundreds of requests only makes a
 * rate limit worse.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError(`Concurrency limit must be a positive integer, got ${limit}`)
    }

    const results: R[] = new Array<R>(items.length)
    let nextIndex = 0
    const failures: unknown[] = []

    async function runLane(): Promise<void> {
        while (failures.length === 0 && nextIndex < items.length) {
            const index = nextIndex++
            try {
                results[index] = await worker(items[index]!, index)
            } catch (error) {
                failures.push(error)
            }
        }
    }

    const laneCount = Math.min(limit, items.length)
    const lanes: Promise<void>[] = []
    for (let i = 0; i < laneCount; i++) {
        lanes.push(runLane())
    }
    await Promise.all(lanes)

    if (failures.length > 0) {
        throw failures[0]
    }
    return results
}
