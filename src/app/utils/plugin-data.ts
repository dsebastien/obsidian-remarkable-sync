/**
 * Merge a patch into the plugin's `data.json` contents.
 *
 * `saveData` replaces the whole file, so every write has to start from the last
 * known contents — writing just the settings object would drop sibling entries
 * such as the stored tokens.
 *
 * A patch entry of `undefined` or `null` removes the key.
 */
/**
 * Serialize async writes so concurrent callers cannot interleave a
 * read-modify-write and lose one of the changes.
 *
 * A failing task rejects to its own caller only: the queue continues from a
 * settled state, because chaining on the fulfilled path alone would leave it
 * permanently rejected and silently skip every later write.
 */
export function createWriteQueue(): (task: () => Promise<void>) => Promise<void> {
    let tail: Promise<void> = Promise.resolve()
    return (task: () => Promise<void>): Promise<void> => {
        const run = tail.then(task)
        tail = run.catch((): void => undefined)
        return run
    }
}

export function mergePluginData(
    current: Record<string, unknown>,
    patch: Record<string, unknown>
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...current }
    for (const [key, value] of Object.entries(patch)) {
        if (undefined === value || null === value) {
            delete merged[key]
        } else {
            merged[key] = value
        }
    }
    return merged
}
