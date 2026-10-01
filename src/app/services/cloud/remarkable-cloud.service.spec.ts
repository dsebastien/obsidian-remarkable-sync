import { describe, expect, spyOn, test } from 'bun:test'
import type { TokenOutcome } from '../auth/remarkable-auth.service'
import {
    AUTHENTICATION_FAILED,
    SESSION_RENEWAL_FAILED,
    createRemarkableCloudService,
    resolveFolderPath
} from './remarkable-cloud.service'
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
    /** Hashes whose request fails after exhausting its retries (counted by the budget). */
    readonly exhausting = new Set<string>()
    readonly fetched: string[] = []
    readonly budgets: (RequestBudget | undefined)[] = []
    rootExtraLines = ''
    /** `lastModified` written into the metadata of entries added from now on. */
    lastModified = '1700000000000'
    /** Index schema: 4 heads every index with a `0:name:count:size` info line. */
    schema: 3 | 4 = 3
    /** Scripted root-hash outcomes, consumed in order; empty means success. */
    readonly rootScript: ('401' | 'ok')[] = []
    refreshes = 0
    /** What the auth service answers: a token, or why not. */
    initialToken: TokenOutcome = { token: 'token' }
    refreshedToken: TokenOutcome = { token: 'token-2' }
    unloadSignal = new AbortController().signal
    private root: { id: string; indexHash: string }[] = []
    onFetch: ((hash: string, budget: RequestBudget | undefined) => void) | null = null

    folder(id: string, name: string, parent = '', version = 1): this {
        return this.entry(id, { type: 'CollectionType', visibleName: name, parent }, [], version)
    }

    doc(id: string, name: string, parent = '', files: string[] = [], version = 1): this {
        return this.entry(id, { type: 'DocumentType', visibleName: name, parent }, files, version)
    }

    corruptIndex(id: string, version = 1): this {
        return this.appendToIndex(id, 'garbled', version)
    }

    appendToIndex(id: string, line: string, version = 1): this {
        const key = `idx-${id}-v${version}`
        this.blobs.set(key, `${this.blobs.get(key)}${line}\n`)
        return this
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
            JSON.stringify({ deleted: false, lastModified: this.lastModified, ...meta })
        )
        const lines = [`${metaHash}:0:${id}.metadata:0:0`]
        for (const file of files) {
            const fileHash = `file-${id}-${file}-v${version}`
            this.blobs.set(fileHash, `content of ${file}`)
            lines.push(`${fileHash}:0:${id}/${file}:0:0`)
        }
        const indexHash = `idx-${id}-v${version}`
        this.blobs.set(indexHash, this.index(lines, id))
        this.root = [...this.root.filter((e) => e.id !== id), { id, indexHash }]
        return this
    }

    private index(lines: string[], name: string): string {
        // Schema 4 as rmapi-js writes it: `.` names the root, a document id its index.
        const header = this.schema === 4 ? `4\n0:${name}:${lines.length}:0` : '3'
        return `${header}\n${lines.join('\n')}\n`
    }

    transport(): CloudTransport {
        return {
            fetchRootHash: (_token, _base, budget) =>
                Promise.resolve().then(() => {
                    // Mirrors the real fetchRootHash: a spent budget makes no request.
                    if (budget?.exhaustedReason) return null
                    if (this.rootScript.shift() === '401') {
                        throw Object.assign(new Error('HTTP 401'), { status: 401 })
                    }
                    const lines = this.root.map((e) => `${e.indexHash}:80000000:${e.id}:0:0`)
                    this.blobs.set('root', `${this.index(lines, '.')}${this.rootExtraLines}`)
                    return 'root'
                }),
            fetchBlob: (_token, hash, _name, _base, budget) =>
                Promise.resolve().then(() => {
                    // Mirrors the real fetchBlob: a spent budget makes no request.
                    if (budget?.exhaustedReason) return null
                    this.fetched.push(hash)
                    this.budgets.push(budget)
                    this.onFetch?.(hash, budget)
                    if (this.throwing.has(hash)) throw new Error(`boom ${hash}`)
                    if (this.exhausting.has(hash)) {
                        budget?.recordFailedRequest()
                        return null
                    }
                    budget?.recordAnswered()
                    if (this.failing.has(hash)) return null
                    const text = this.blobs.get(hash)
                    return text === undefined ? null : new TextEncoder().encode(text).buffer
                })
        }
    }

    service(): RemarkableCloudService {
        const host = {
            settings: DEFAULT_SETTINGS,
            authService: {
                acquireUserToken: () => Promise.resolve(this.initialToken),
                forceRefreshUserToken: () => {
                    this.refreshes++
                    return Promise.resolve(this.refreshedToken)
                }
            },
            unloadSignal: this.unloadSignal
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

    test('a schema 4 cloud lists completely, never fetching the info line', async () => {
        // #44, #45: the `0:.:count:size` line was read as an entry with hash 0.
        const cloud = new FakeCloud()
        cloud.schema = 4
        cloud.folder('f', 'Work').doc('d1', 'Notes', 'f')
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(true)
        expect(listing.error).toBeNull()
        expect(listing.notebooks.map((n) => [n.id, n.folderPath])).toEqual([['d1', 'Work']])
        expect(cloud.fetched).not.toContain('0')
    })

    test('warns once a session about a timestamp the sync decision cannot read', async () => {
        // Such a notebook counts as synced forever (see deriveSyncStatus), so
        // a format change in the cloud must leave a trace.
        const cloud = new FakeCloud()
        cloud.lastModified = '2026-10-01T10:00:00Z'
        cloud.doc('d1', 'One').doc('d2', 'Two')
        const warn = spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const service = cloud.service()
            await service.listDocuments()
            await service.listDocuments()
            const timestampWarnings = warn.mock.calls.filter((call) =>
                String(call[0]).includes('timestamp')
            )
            expect(timestampWarnings).toHaveLength(1)
        } finally {
            warn.mockRestore()
        }
    })

    test('says nothing about plain integer timestamps', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        const warn = spyOn(console, 'warn').mockImplementation(() => {})
        try {
            await cloud.service().listDocuments()
            expect(warn).not.toHaveBeenCalled()
        } finally {
            warn.mockRestore()
        }
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

    test('an entry whose content is unusable is not fetched again while unchanged', async () => {
        const cloud = new FakeCloud().doc('d1', 'One').doc('d2', 'Two')
        cloud.blobs.set('meta-d2-v1', 'not json')
        const service = cloud.service()
        expect((await service.listDocuments()).unreadableIds).toEqual(['d2'])

        cloud.fetched.length = 0
        const second = await service.listDocuments()
        expect(second.unreadableIds).toEqual(['d2'])
        expect(cloud.fetched).toEqual(['root'])

        // A new version of it is read again.
        cloud.doc('d2', 'Two', '', [], 2)
        cloud.fetched.length = 0
        const third = await service.listDocuments()
        expect(third.complete).toBe(true)
        expect(cloud.fetched).toEqual(['root', 'idx-d2-v2', 'meta-d2-v2'])
    })

    test('an index without metadata is remembered as unusable too', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        cloud.blobs.set('idx-d1-v1', '3\nfile-x:0:d1/a.rm:0:0\n')
        const service = cloud.service()
        await service.listDocuments()
        cloud.fetched.length = 0
        await service.listDocuments()
        expect(cloud.fetched).toEqual(['root'])
    })

    test('a failed request is retried on the next listing, not remembered', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        cloud.failing.add('meta-d1-v1')
        const service = cloud.service()
        await service.listDocuments()
        cloud.failing.clear()
        cloud.fetched.length = 0
        const second = await service.listDocuments()
        expect(second.complete).toBe(true)
        expect(cloud.fetched).toEqual(['root', 'idx-d1-v1', 'meta-d1-v1'])
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

    test('consecutive exhausted requests stop the listing and report why', async () => {
        const cloud = new FakeCloud()
        for (let i = 0; i < 20; i++) cloud.doc(`d${i}`, `Doc ${i}`)
        for (let i = 0; i < 20; i++) cloud.exhausting.add(`idx-d${i}-v1`)
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(false)
        expect(listing.error).toContain('keeps failing')
        // Stopped after a few failures, not one per entry.
        expect(cloud.fetched.length).toBeLessThan(20)
        // One budget for the whole listing.
        expect(new Set(cloud.budgets).size).toBe(1)
        expect(cloud.budgets[0]).toBeInstanceOf(RequestBudget)
    })

    test('a budget stopped after every entry was read keeps the listing complete', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        cloud.onFetch = (hash, budget): void => {
            if (hash === 'meta-d1-v1') budget?.stop('late stop')
        }
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(true)
        expect(listing.error).toBeNull()
    })

    test('the listing carries the ids it could not read, and withheld ones', async () => {
        const cloud = new FakeCloud().folder('f', 'Work').doc('d1', 'Notes', 'f').doc('d2', 'Two')
        cloud.failing.add('meta-f-v1')
        const listing = await cloud.service().listDocuments()
        expect([...(listing.unreadableIds ?? [])].sort()).toEqual(['d1', 'f'])
    })

    test('rejected root lines make the unreadable ids unknown', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        cloud.rootExtraLines = 'garbled-line\n'
        expect((await cloud.service().listDocuments()).unreadableIds).toBeNull()
    })

    test('an unloaded plugin makes no request at all', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        const controller = new AbortController()
        controller.abort()
        cloud.unloadSignal = controller.signal
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(false)
        expect(listing.error).toContain('unloaded')
        expect(cloud.fetched).toEqual([])
    })

    test('a budget stopped while reading the root index reports its reason', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        cloud.onFetch = (hash, budget): void => {
            if (hash === 'root') {
                budget?.stop('rate limited')
                cloud.failing.add(hash)
            }
        }
        const listing = await cloud.service().listDocuments()
        expect(listing.complete).toBe(false)
        expect(listing.error).toBe('rate limited')
    })

    test('a 401 refreshes the token once and the listing proceeds', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        cloud.rootScript.push('401')
        const listing = await cloud.service().listDocuments()
        expect(cloud.refreshes).toBe(1)
        expect(listing.complete).toBe(true)
    })

    test('a failed refresh or a second 401 asks to reconnect', async () => {
        const failedRefresh = new FakeCloud().doc('d1', 'One')
        failedRefresh.rootScript.push('401')
        failedRefresh.refreshedToken = { failure: 'rejected' }
        expect((await failedRefresh.service().listDocuments()).error).toBe(AUTHENTICATION_FAILED)

        const twice = new FakeCloud().doc('d1', 'One')
        twice.rootScript.push('401', '401')
        expect((await twice.service().listDocuments()).error).toBe(AUTHENTICATION_FAILED)
    })

    test('no connection asks to reconnect and makes no request', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        cloud.initialToken = { failure: 'not-connected' }
        expect((await cloud.service().listDocuments()).error).toBe(AUTHENTICATION_FAILED)
        expect(cloud.fetched).toEqual([])
    })

    test('an unreachable token endpoint is not a reason to reconnect', async () => {
        const expired = new FakeCloud().doc('d1', 'One')
        expired.initialToken = { failure: 'unreachable' }
        expect((await expired.service().listDocuments()).error).toBe(SESSION_RENEWAL_FAILED)

        const onRefresh = new FakeCloud().doc('d1', 'One')
        onRefresh.rootScript.push('401')
        onRefresh.refreshedToken = { failure: 'unreachable' }
        expect((await onRefresh.service().listDocuments()).error).toBe(SESSION_RENEWAL_FAILED)
    })

    test('the budget is detached from the unload signal once the listing ends', async () => {
        const cloud = new FakeCloud().doc('d1', 'One')
        const controller = new AbortController()
        cloud.unloadSignal = controller.signal
        let stoppedAfterwards: RequestBudget | undefined
        cloud.onFetch = (_hash, budget): void => {
            stoppedAfterwards = budget
        }
        await cloud.service().listDocuments()
        controller.abort()
        // Detached: unloading after the listing no longer reaches its budget.
        expect(stoppedAfterwards?.exhaustedReason).toBeNull()
    })
})

describe('downloadDocument against an in-memory cloud', () => {
    test('returns every file of the document', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm', 'b.rm'])
        const files = await cloud.service().downloadDocument('d1')
        expect(files instanceof Map ? [...files.keys()].sort() : files).toEqual([
            'd1.metadata',
            'd1/a.rm',
            'd1/b.rm'
        ])
    })

    test('downloads a schema 4 document without fetching the info line', async () => {
        const cloud = new FakeCloud()
        cloud.schema = 4
        cloud.doc('d1', 'One', '', ['a.rm'])
        const files = await cloud.service().downloadDocument('d1')
        expect(files instanceof Map ? [...files.keys()].sort() : files).toEqual([
            'd1.metadata',
            'd1/a.rm'
        ])
        expect(cloud.fetched).not.toContain('0')
    })

    test('every file fetch of one download shares one budget, without a deadline', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm', 'b.rm'])
        const service = cloud.service()
        await service.listDocuments()
        cloud.budgets.length = 0
        await service.downloadDocument('d1')
        expect(cloud.budgets).toHaveLength(4)
        expect(new Set(cloud.budgets).size).toBe(1)
        const budget = cloud.budgets[0]!
        expect(budget).toBeInstanceOf(RequestBudget)
        expect(Reflect.get(budget, 'deadline')).toBeNull()
    })

    test('a file listed twice in the index is downloaded, not counted as missing', async () => {
        // The map keys by file id, so comparing its size to the line count
        // failed this notebook on every sync, forever.
        const cloud = new FakeCloud()
            .doc('d1', 'One', '', ['a.rm'])
            .appendToIndex('d1', 'file-d1-a.rm-v1:0:d1/a.rm:0:0')
        const files = await cloud.service().downloadDocument('d1')
        expect(files instanceof Map ? [...files.keys()].sort() : files).toEqual([
            'd1.metadata',
            'd1/a.rm'
        ])
    })

    test('fails when the document index has a line it cannot parse', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm']).corruptIndex('d1')
        expect(await cloud.service().downloadDocument('d1')).toEqual({ error: 'Download failed' })
    })

    test('says why: the notebook left the cloud', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm'])
        expect(await cloud.service().downloadDocument('gone')).toEqual({
            error: 'The notebook is no longer in the reMarkable cloud'
        })
    })

    test('fails when any file could not be fetched, instead of dropping pages', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm', 'b.rm'])
        cloud.failing.add('file-d1-b.rm-v1')
        expect(await cloud.service().downloadDocument('d1')).toEqual({ error: 'Download failed' })
    })

    test('says why: an authentication failure', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm'])
        cloud.initialToken = { failure: 'rejected' }
        expect(await cloud.service().downloadDocument('d1')).toEqual({
            error: AUTHENTICATION_FAILED
        })

        const cached = new FakeCloud().doc('d1', 'One', '', ['a.rm'])
        const service = cached.service()
        await service.listDocuments()
        cached.initialToken = { failure: 'unreachable' }
        expect(await service.downloadDocument('d1')).toEqual({ error: SESSION_RENEWAL_FAILED })
    })

    test('says why: the budget stopped', async () => {
        const cloud = new FakeCloud().doc('d1', 'One', '', ['a.rm'])
        cloud.onFetch = (hash, budget): void => {
            if (hash === 'file-d1-a.rm-v1') {
                budget?.stop('rate limited')
                cloud.failing.add(hash)
            }
        }
        expect(await cloud.service().downloadDocument('d1')).toEqual({ error: 'rate limited' })
    })
})
