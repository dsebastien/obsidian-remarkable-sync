/**
 * Run `fn` over every item with at most `limit` calls in flight at once.
 *
 * Settles like `Promise.allSettled`: one rejection never stops the others, and
 * results keep the order of `items`. Exists because mapping a whole cloud
 * listing into `Promise.allSettled` fired two requests per document and folder
 * at once, which on a large account is a burst of hundreds (issue #28).
 */
export async function mapSettledWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length)
    const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
    let next = 0

    async function worker(): Promise<void> {
        while (next < items.length) {
            const index = next++
            try {
                results[index] = { status: 'fulfilled', value: await fn(items[index]!, index) }
            } catch (reason: unknown) {
                results[index] = { status: 'rejected', reason }
            }
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return results
}
