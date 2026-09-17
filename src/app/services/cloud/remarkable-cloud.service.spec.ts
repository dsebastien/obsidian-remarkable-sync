import { beforeEach, describe, expect, test } from 'bun:test'
import type { RemarkableSyncPlugin } from '../../plugin'
import { DEFAULT_SETTINGS } from '../../types/plugin-settings.intf'
import type { RemarkableDocumentMetadata } from '../../domain/remarkable-types'
import { SyncRequestError } from './http-retry'
import {
    CLOUD_REQUEST_CONCURRENCY,
    createRemarkableCloudService,
    RemarkableCloudError,
    resolveFolderPath,
    type CloudTransport
} from './remarkable-cloud.service'
import { docIndexFilename, ROOT_INDEX_FILENAME } from './sync-protocol'

/** Await a promise that must reject, and hand back what it rejected with. */
async function rejection(run: Promise<unknown>): Promise<unknown> {
    try {
        await run
    } catch (error) {
        return error
    }
    throw new Error('expected the promise to reject')
}

const encoder = new TextEncoder()
const encode = (text: string): ArrayBuffer => encoder.encode(text).buffer

interface FakeEntry {
    readonly id: string
    readonly hash: string
    readonly metadata: Partial<RemarkableDocumentMetadata> | null
    /** Extra files in the entry's own index, path -> content. */
    readonly files?: Record<string, string>
    /** Serve this raw text as the .metadata blob instead of JSON. */
    readonly rawMetadata?: string
}

function metadataOf(entry: FakeEntry): RemarkableDocumentMetadata {
    return {
        deleted: false,
        lastModified: '1700000000000',
        lastOpened: '',
        lastOpenedPage: 0,
        metadatamodified: false,
        modified: false,
        parent: '',
        pinned: false,
        synced: true,
        type: 'DocumentType',
        version: 1,
        visibleName: entry.id,
        ...entry.metadata
    }
}

/**
 * An in-memory sync service: a root index of entries, each with its own
 * index and metadata blob. Requests are recorded, and any blob can be made
 * to fail through `failures`.
 */
class FakeCloud implements CloudTransport {
    rootHash = 'root-1'
    entries: FakeEntry[] = []
    requests: string[] = []
    /** rm-filename -> error to throw (once per entry in the queue). */
    failures = new Map<string, Error[]>()
    rootHashFailures: Error[] = []
    inFlight = 0
    peakInFlight = 0

    async fetchRootHash(): Promise<string> {
        this.requests.push('root')
        const failure = this.rootHashFailures.shift()
        if (failure !== undefined) throw failure
        return this.rootHash
    }

    async fetchBlob(_token: string, hash: string, rmFilename: string): Promise<ArrayBuffer> {
        this.requests.push(rmFilename)
        this.inFlight++
        this.peakInFlight = Math.max(this.peakInFlight, this.inFlight)
        try {
            await new Promise((resolve) => setTimeout(resolve, 1))
            const failure = this.failures.get(rmFilename)?.shift()
            if (failure !== undefined) throw failure
            return this.blobFor(hash, rmFilename)
        } finally {
            this.inFlight--
        }
    }

    private blobFor(hash: string, rmFilename: string): ArrayBuffer {
        if (rmFilename === ROOT_INDEX_FILENAME) {
            const lines = this.entries.map((e) => `${e.hash}:80000000:${e.id}:0:0`)
            return encode(`3\n${lines.length}\n${lines.join('\n')}\n`)
        }
        for (const entry of this.entries) {
            if (rmFilename === docIndexFilename(entry.id)) {
                const lines: string[] = []
                if (entry.metadata !== null) {
                    lines.push(`${entry.hash}-meta:0:${entry.id}.metadata:0:0`)
                }
                for (const path of Object.keys(entry.files ?? {})) {
                    lines.push(`${entry.hash}-${path}:0:${path}:0:0`)
                }
                return encode(`3\n${lines.length}\n${lines.join('\n')}\n`)
            }
            if (rmFilename === `${entry.id}.metadata`) {
                return encode(entry.rawMetadata ?? JSON.stringify(metadataOf(entry)))
            }
            const file = entry.files?.[rmFilename]
            if (file !== undefined) {
                return encode(file)
            }
        }
        throw new Error(`FakeCloud: no blob for ${rmFilename} (${hash})`)
    }
}

function makePlugin(tokens: { user?: string | null; refreshed?: string | null } = {}) {
    const calls = { getUserToken: 0, refreshAndGetUserToken: 0 }
    const plugin = {
        settings: DEFAULT_SETTINGS,
        authService: {
            getUserToken: async () => {
                calls.getUserToken++
                return tokens.user === undefined ? 'user-token' : tokens.user
            },
            refreshAndGetUserToken: async () => {
                calls.refreshAndGetUserToken++
                return tokens.refreshed === undefined ? 'refreshed-token' : tokens.refreshed
            }
        }
    }
    return { plugin: plugin as unknown as RemarkableSyncPlugin, calls }
}

function folder(
    id: string,
    name: string,
    parent = '',
    extra: Partial<RemarkableDocumentMetadata> = {}
): FakeEntry {
    return {
        id,
        hash: `${id}-h1`,
        metadata: { type: 'CollectionType', visibleName: name, parent, ...extra }
    }
}

function doc(
    id: string,
    name: string,
    parent = '',
    extra: Partial<RemarkableDocumentMetadata> = {}
): FakeEntry {
    return {
        id,
        hash: `${id}-h1`,
        metadata: { type: 'DocumentType', visibleName: name, parent, ...extra }
    }
}

const http = (status: number, retryable = false): SyncRequestError =>
    new SyncRequestError(`blob: HTTP ${status}`, { status, retryable, attempts: 1 })

describe('resolveFolderPath', () => {
    const folders = new Map([
        ['a', { name: 'Work', parent: '' }],
        ['b', { name: 'Projects', parent: 'a' }],
        ['c', { name: 'Old', parent: 'trash' }],
        ['loop1', { name: 'L1', parent: 'loop2' }],
        ['loop2', { name: 'L2', parent: 'loop1' }]
    ])

    test('joins the chain root-first', () => {
        expect(resolveFolderPath('b', folders)).toEqual({ kind: 'resolved', path: 'Work/Projects' })
    })

    test('an empty parent is the root', () => {
        expect(resolveFolderPath('', folders)).toEqual({ kind: 'resolved', path: '' })
    })

    test('a chain that reaches the trash is trashed, at any depth', () => {
        expect(resolveFolderPath('trash', folders)).toEqual({ kind: 'trashed' })
        expect(resolveFolderPath('c', folders)).toEqual({ kind: 'trashed' })
    })

    test('a folder the map does not hold is reported, not truncated', () => {
        expect(resolveFolderPath('missing', folders)).toEqual({
            kind: 'unresolved',
            folderId: 'missing'
        })
        const dangling = new Map([['b', { name: 'Projects', parent: 'gone' }]])
        expect(resolveFolderPath('b', dangling)).toEqual({ kind: 'unresolved', folderId: 'gone' })
    })

    test('a cycle terminates', () => {
        expect(resolveFolderPath('loop1', folders)).toEqual({ kind: 'resolved', path: 'L2/L1' })
    })
})

describe('createRemarkableCloudService', () => {
    let cloud: FakeCloud

    beforeEach(() => {
        cloud = new FakeCloud()
    })

    describe('listDocuments', () => {
        test('lists documents with their folder paths and skips trash and deleted', async () => {
            cloud.entries = [
                folder('f-work', 'Work'),
                folder('f-proj', 'Projects', 'f-work'),
                folder('f-trashed', 'Gone', 'trash'),
                doc('d-root', 'Root note'),
                doc('d-deep', 'Deep note', 'f-proj'),
                doc('d-trash', 'Binned', 'trash'),
                doc('d-in-trashed-folder', 'Binned with folder', 'f-trashed'),
                doc('d-deleted', 'Deleted', '', { deleted: true })
            ]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            const listed = await service.listDocuments()

            expect(listed.map((nb) => [nb.id, nb.folderPath])).toEqual([
                ['d-root', ''],
                ['d-deep', 'Work/Projects']
            ])
        })

        test('a deleted folder still names the path of a document filed under it', async () => {
            cloud.entries = [
                folder('f-old', 'Old', '', { deleted: true }),
                doc('d-1', 'Note', 'f-old')
            ]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            const listed = await service.listDocuments()

            expect(listed[0]!.folderPath).toBe('Old')
        })

        test('never has more than the concurrency limit of blob requests in flight', async () => {
            cloud.entries = Array.from({ length: 40 }, (_, i) => doc(`d-${i}`, `Note ${i}`))
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            await service.listDocuments()

            expect(cloud.peakInFlight).toBe(CLOUD_REQUEST_CONCURRENCY)
        })

        test('a metadata blob that cannot be fetched fails the listing instead of dropping the document', async () => {
            cloud.entries = [doc('d-1', 'One'), doc('d-2', 'Two'), doc('d-3', 'Three')]
            cloud.failures.set('d-2.metadata', [http(429, true)])
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            const run = service.listDocuments()

            const error = (await rejection(run)) as Error
            expect(error).toBeInstanceOf(RemarkableCloudError)
            expect(error.message).toContain('HTTP 429')
        })

        test('a folder whose metadata cannot be fetched fails the listing instead of shortening paths', async () => {
            cloud.entries = [folder('f-work', 'Work'), doc('d-1', 'Note', 'f-work')]
            cloud.failures.set(docIndexFilename('f-work'), [http(503, true)])
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            expect(await rejection(service.listDocuments())).toBeInstanceOf(RemarkableCloudError)
        })

        test('the first failure stops the listing from issuing the remaining requests', async () => {
            cloud.entries = Array.from({ length: 30 }, (_, i) => doc(`d-${i}`, `Note ${i}`))
            cloud.failures.set(docIndexFilename('d-0'), [http(429, true)])
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            expect(await rejection(service.listDocuments())).toBeInstanceOf(RemarkableCloudError)

            // root index + at most one bounded wave of index requests
            const blobRequests = cloud.requests.filter((r) => r !== 'root').length
            expect(blobRequests).toBeLessThanOrEqual(1 + CLOUD_REQUEST_CONCURRENCY * 2)
        })

        test('a document filed under a folder the root index does not hold fails the listing', async () => {
            cloud.entries = [doc('d-1', 'Orphan', 'f-nowhere')]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            const run = service.listDocuments()

            const error = (await rejection(run)) as Error
            expect(error).toBeInstanceOf(RemarkableCloudError)
            expect(error.message).toContain('f-nowhere')
            expect(error.message).toContain('Orphan')
        })

        test('an entry with no .metadata file is skipped, not a failure', async () => {
            cloud.entries = [{ id: 'stray', hash: 'stray-h1', metadata: null }, doc('d-1', 'Note')]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            const listed = await service.listDocuments()

            expect(listed.map((nb) => nb.id)).toEqual(['d-1'])
        })

        test('an entry whose metadata is not JSON is skipped, not a failure', async () => {
            cloud.entries = [
                { id: 'broken', hash: 'broken-h1', metadata: {}, rawMetadata: '{not json' },
                doc('d-1', 'Note')
            ]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            const listed = await service.listDocuments()

            expect(listed.map((nb) => nb.id)).toEqual(['d-1'])
        })

        test('metadata is re-fetched only for entries whose hash moved', async () => {
            cloud.entries = [folder('f-1', 'Work'), doc('d-1', 'One', 'f-1'), doc('d-2', 'Two')]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)
            await service.listDocuments()
            cloud.requests.length = 0

            // Second listing, nothing changed: only the root is fetched.
            cloud.rootHash = 'root-2'
            const unchanged = await service.listDocuments()
            expect(unchanged.map((nb) => [nb.id, nb.folderPath])).toEqual([
                ['d-1', 'Work'],
                ['d-2', '']
            ])
            expect(cloud.requests).toEqual(['root', ROOT_INDEX_FILENAME])

            // Third listing, d-2 was edited: exactly its two blobs are fetched.
            cloud.entries = [
                folder('f-1', 'Work'),
                doc('d-1', 'One', 'f-1'),
                { ...doc('d-2', 'Two renamed'), hash: 'd-2-h2' }
            ]
            cloud.rootHash = 'root-3'
            cloud.requests.length = 0
            const changed = await service.listDocuments()
            expect(changed.find((nb) => nb.id === 'd-2')?.visibleName).toBe('Two renamed')
            expect(cloud.requests).toEqual([
                'root',
                ROOT_INDEX_FILENAME,
                docIndexFilename('d-2'),
                'd-2.metadata'
            ])
        })

        test('the cache forgets entries that left the root index', async () => {
            cloud.entries = [doc('d-1', 'One'), doc('d-2', 'Two')]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)
            await service.listDocuments()

            cloud.entries = [doc('d-1', 'One')]
            await service.listDocuments()

            // d-2 comes back with the same hash: it must be fetched again, not
            // served from a cache that outlived its presence in the account.
            cloud.entries = [doc('d-1', 'One'), doc('d-2', 'Two')]
            cloud.requests.length = 0
            await service.listDocuments()
            expect(cloud.requests).toContain('d-2.metadata')
        })

        test('a 401 on the root hash refreshes the token once and retries', async () => {
            cloud.entries = [doc('d-1', 'One')]
            cloud.rootHashFailures = [http(401)]
            const { plugin, calls } = makePlugin()
            const service = createRemarkableCloudService(plugin, cloud)

            const listed = await service.listDocuments()

            expect(listed.length).toBe(1)
            expect(calls.refreshAndGetUserToken).toBe(1)
        })

        test('a non-401 root hash failure is not mistaken for an expired token', async () => {
            cloud.entries = [doc('d-1', 'One')]
            cloud.rootHashFailures = [http(503, true)]
            const { plugin, calls } = makePlugin()
            const service = createRemarkableCloudService(plugin, cloud)

            expect(await rejection(service.listDocuments())).toBeInstanceOf(RemarkableCloudError)
            expect(calls.refreshAndGetUserToken).toBe(0)
        })

        test('not being authenticated is an error, not an empty account', async () => {
            cloud.entries = [doc('d-1', 'One')]
            const service = createRemarkableCloudService(makePlugin({ user: null }).plugin, cloud)

            const error = (await rejection(service.listDocuments())) as Error
            expect(error.message).toContain('Not authenticated')
        })
    })

    describe('downloadDocument', () => {
        test('downloads every file named by the document index', async () => {
            cloud.entries = [
                {
                    ...doc('d-1', 'One'),
                    files: {
                        'd-1.content': '{}',
                        'd-1/page-1.rm': 'ink',
                        'd-1/page-2.rm': 'more ink'
                    }
                }
            ]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)
            await service.listDocuments()

            const files = await service.downloadDocument('d-1')

            expect(files).not.toBeNull()
            expect([...files!.keys()].sort()).toEqual([
                'd-1.content',
                'd-1.metadata',
                'd-1/page-1.rm',
                'd-1/page-2.rm'
            ])
        })

        test('a page that cannot be fetched fails the document rather than dropping the page', async () => {
            cloud.entries = [
                { ...doc('d-1', 'One'), files: { 'd-1/page-1.rm': 'ink', 'd-1/page-2.rm': 'more' } }
            ]
            cloud.failures.set('d-1/page-2.rm', [http(429, true)])
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)
            await service.listDocuments()

            const files = await service.downloadDocument('d-1')

            expect(files).toBeNull()
        })

        test('resolves the index hash from the root when the document was not listed first', async () => {
            cloud.entries = [{ ...doc('d-1', 'One'), files: { 'd-1/page-1.rm': 'ink' } }]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            const files = await service.downloadDocument('d-1')

            expect(files?.has('d-1/page-1.rm')).toBe(true)
            expect(cloud.requests[0]).toBe('root')
        })

        test('an unknown document id is null', async () => {
            cloud.entries = [doc('d-1', 'One')]
            const service = createRemarkableCloudService(makePlugin().plugin, cloud)

            expect(await service.downloadDocument('nope')).toBeNull()
        })
    })
})
