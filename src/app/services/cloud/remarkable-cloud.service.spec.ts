import { describe, expect, test } from 'bun:test'
import { createRemarkableCloudService, resolveFolderPath } from './remarkable-cloud.service'
import type {
    CloudServiceHost,
    CloudTransport,
    RemarkableCloudService
} from './remarkable-cloud.service'
import { RequestBudget } from './sync-protocol'
import { DEFAULT_SETTINGS } from '../../types/plugin-settings.intf'

describe('resolveFolderPath', () => {
    const names = new Map([
        ['a', 'Work'],
        ['b', 'Meetings'],
        ['c', 'Q3']
    ])
    const parents = new Map([
        ['a', ''],
        ['b', 'a'],
        ['c', 'b']
    ])

    test('walks the full parent chain', () => {
        expect(resolveFolderPath('c', names, parents, new Set())).toBe('Work/Meetings/Q3')
    })

    test('top level and trash resolve to the root', () => {
        expect(resolveFolderPath('', names, parents, new Set())).toBe('')
        expect(resolveFolderPath('trash', names, parents, new Set())).toBe('')
    })

    test('refuses a path when a folder in the chain could not be read', () => {
        // A shortened path would write the notebook into the wrong vault folder.
        expect(resolveFolderPath('c', names, parents, new Set(['a']))).toBeNull()
        expect(resolveFolderPath('c', names, parents, new Set(['c']))).toBeNull()
    })

    test('a genuinely absent parent ends the chain as before', () => {
        const orphanParents = new Map([...parents, ['a', 'gone']])
        expect(resolveFolderPath('c', names, orphanParents, new Set())).toBe('Work/Meetings/Q3')
    })

    test('a cycle terminates', () => {
        const cyclic = new Map([
            ['a', 'b'],
            ['b', 'a']
        ])
        expect(resolveFolderPath('b', names, cyclic, new Set())).toBe('Work/Meetings')
    })
})

/**
 * An in-memory reMarkable cloud: a root index naming one index blob per entry,
 * each index naming a `.metadata` blob (and, for documents, content files).
 * Any hash can be scripted to fail (null) or throw; every fetch is counted.
 */
class FakeCloud {
    readonly blobs = new Map<string, string>()
    readonly failing = new Set<string>()
    readonly throwing = new Set<string>()
    readonly fetched: string[] = []
    rootExtraLines = ''
    private root: { id: string; indexHash: string }[] = []
    onFetch: ((hash: string, budget: RequestBudget | undefined) => void) | null = null

    folder(id: string, name: string, parent = '', version = 1): this {
        return this.entry(id, { type: 'CollectionType', visibleName: name, parent }, [], version)
    }

    doc(id: string, name: string, parent = '', files: string[] = [], version = 1): this {
        return this.entry(id, { type: 'DocumentType', visibleName: name, parent }, files, version)
    }

    remove(id: string): this {
        this.root = this.root.filter((e) => e.id !== id)
        return this
    }

    private entry(
        id: string,
        meta: { type: string; visibleName: string; parent: string },
        files: string[],
        version: number
    ): this {
        const metaHash = `meta-${id}-v${version}`
        this.blobs.set(
            metaHash,
            JSON.stringify({ deleted: false, lastModified: '1700000000000', ...meta })
        )
        const lines = [`${metaHash}:0:${id}.metadata:0:0`]
        for (const file of files) {
            const fileHash = `file-${id}-${file}-v${version}`
            this.blobs.set(fileHash, `content of ${file}`)
            lines.push(`${fileHash}:0:${id}/${file}:0:0`)
        }
        const indexHash = `idx-${id}-v${version}`
        this.blobs.set(indexHash, `3\n${lines.join('\n')}\n`)
        this.root = [...this.root.filter((e) => e.id !== id), { id, indexHash }]
        return this
    }

    transport(): CloudTransport {
        return {
            fetchRootHash: async () => {
                const lines = this.root.map((e) => `${e.indexHash}:80000000:${e.id}:0:0`)
                this.blobs.set('root', `3\n${lines.join('\n')}\n${this.rootExtraLines}`)
                return 'root'
            },
            fetchBlob: async (_token, hash, _name, _base, budget) => {
                this.fetched.push(hash)
                this.onFetch?.(hash, budget)
                if (this.throwing.has(hash)) throw new Error(`boom ${hash}`)
                if (this.failing.has(hash)) return null
                const text = this.blobs.get(hash)
                return text === undefined ? null : new TextEncoder().encode(text).buffer
            }
        }
    }

    service(): RemarkableCloudService {
        const host = {
            settings: DEFAULT_SETTINGS,
            authService: {
                getUserToken: async () => 'token',
                refreshAndGetUserToken: async () => 'token'
            },
            unloadSignal: new AbortController().signal
        } as unknown as CloudServiceHost
        return createRemarkableCloudService(host, this.transport())
    }
}

describe('listDocuments against an in-memory cloud', () => {
    test('lists documents with their folder paths and reports complete', async () => {
        const cloud = new FakeCloud().folder('f', 'Work').doc('d1', 'Notes', 'f').doc('d2', 'Top')
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(true)
        expect(listing.error).toBeNull()
        expect(listing.notebooks.map((n) => [n.id, n.folderPath]).sort()).toEqual([
            ['d1', 'Work'],
            ['d2', '']
        ])
    })

    test('an unreadable folder withholds its notebooks and both count as unreadable', async () => {
        const cloud = new FakeCloud().folder('f', 'Work').doc('d1', 'Notes', 'f').doc('d2', 'Top')
        cloud.failing.add('meta-f-v1')
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(false)
        expect(listing.notebooks.map((n) => n.id)).toEqual(['d2'])
        expect(listing.error).toBe('2 item(s) could not be read from the reMarkable cloud')
    })

    test('an entry whose fetch throws is unreadable; the rest are still listed', async () => {
        const cloud = new FakeCloud().doc('d1', 'One').doc('d2', 'Two')
        cloud.throwing.add('idx-d1-v1')
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(false)
        expect(listing.notebooks.map((n) => n.id)).toEqual(['d2'])
    })

    test('a rejected line in the root index makes the listing incomplete', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        cloud.rootExtraLines = 'garbled-line\n'
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(false)
        expect(listing.notebooks.map((n) => n.id)).toEqual(['d1'])
    })

    test('an unchanged entry is served from the cache on the next listing', async () => {
        const cloud = new FakeCloud().folder('f', 'Work').doc('d1', 'Notes', 'f')
        const service = cloud.service()
        await service.listDocuments()
        cloud.fetched.length = 0
        const listing = await service.listDocuments()
        expect(listing.complete).toBe(true)
        expect(cloud.fetched).toEqual(['root'])
    })

    test('a changed entry is fetched again, and one that left the root is forgotten', async () => {
        const cloud = new FakeCloud().doc('d1', 'One').doc('d2', 'Two')
        const service = cloud.service()
        await service.listDocuments()

        cloud.doc('d1', 'One renamed', '', [], 2).remove('d2')
        cloud.fetched.length = 0
        const second = await service.listDocuments()
        expect(second.notebooks.map((n) => n.visibleName)).toEqual(['One renamed'])
        expect(cloud.fetched).toEqual(['root', 'idx-d1-v2', 'meta-d1-v2'])

        // d2 comes back with the same hash: the cache dropped it, so it is fetched.
        cloud.doc('d2', 'Two')
        cloud.fetched.length = 0
        await service.listDocuments()
        expect(cloud.fetched).toEqual(['root', 'idx-d2-v1', 'meta-d2-v1'])
    })

    test('every request of one listing shares a budget, whose stop reason is reported', async () => {
        const cloud = new FakeCloud().doc('d1', 'One').doc('d2', 'Two')
        const budgets = new Set<RequestBudget | undefined>()
        cloud.onFetch = (hash, budget): void => {
            budgets.add(budget)
            if (hash === 'idx-d1-v1') {
                budget?.stop('rate limited')
                cloud.failing.add(hash)
            }
        }
        const listing = await cloud.service().listDocuments()
        expect(budgets.size).toBe(1)
        expect([...budgets][0]).toBeInstanceOf(RequestBudget)
        expect(listing.complete).toBe(false)
        expect(listing.error).toBe('rate limited')
    })
})

describe('downloadDocument against an in-memory cloud', () => {
    test('returns every file of the document', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm', 'b.rm'])
        const files = await cloud.service().downloadDocument('d1')
        expect([...(files?.keys() ?? [])].sort()).toEqual(['d1.metadata', 'd1/a.rm', 'd1/b.rm'])
    })

    test('fails when any file could not be fetched, instead of dropping pages', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm', 'b.rm'])
        cloud.failing.add('file-d1-b.rm-v1')
        expect(await cloud.service().downloadDocument('d1')).toBeNull()
    })
})
