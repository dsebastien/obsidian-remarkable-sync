import { test, expect, describe } from 'bun:test'
import { TFile, type Vault } from 'obsidian'
import {
    buildDocumentPath,
    buildPagePath,
    buffersEqual,
    writeBinaryIfChanged,
    writeDocumentPdf,
    writePageImage
} from './markdown-writer.service'

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer

interface FakeVaultCalls {
    created: string[]
    modified: string[]
    foldersCreated: string[]
}

/**
 * Minimal stand-in for the parts of `Vault` the writer touches. `files` seeds
 * the vault with existing content, keyed by path.
 */
function createFakeVault(files: Record<string, ArrayBuffer> = {}): {
    vault: Vault
    calls: FakeVaultCalls
} {
    const calls: FakeVaultCalls = { created: [], modified: [], foldersCreated: [] }
    const store = new Map<string, ArrayBuffer>(Object.entries(files))

    const vault = {
        getAbstractFileByPath: (path: string) => {
            if (!store.has(path)) return null
            const file = new TFile()
            // The writer only uses the instanceof check and passes the value
            // straight back to readBinary/modifyBinary, so a path tag suffices.
            ;(file as TFile & { path: string }).path = path
            return file
        },
        readBinary: async (file: TFile) => {
            const path = (file as TFile & { path: string }).path
            const data = store.get(path)
            if (!data) throw new Error(`missing ${path}`)
            return data
        },
        modifyBinary: async (file: TFile, data: ArrayBuffer) => {
            const path = (file as TFile & { path: string }).path
            calls.modified.push(path)
            store.set(path, data)
        },
        createBinary: async (path: string, data: ArrayBuffer) => {
            calls.created.push(path)
            store.set(path, data)
        },
        createFolder: async (path: string) => {
            calls.foldersCreated.push(path)
        }
    } as unknown as Vault

    return { vault, calls }
}

describe('buildPagePath', () => {
    test('with target folder and folder path', () => {
        expect(buildPagePath('reMarkable', 'Work/Notes', 'Meeting', 0, 'md')).toBe(
            'reMarkable/Work/Notes/Meeting/Meeting-P001.md'
        )
    })

    test('with empty target folder', () => {
        expect(buildPagePath('', 'Work', 'Meeting', 0, 'md')).toBe('Work/Meeting/Meeting-P001.md')
    })

    test('with empty folder path', () => {
        expect(buildPagePath('reMarkable', '', 'Meeting', 0, 'md')).toBe(
            'reMarkable/Meeting/Meeting-P001.md'
        )
    })

    test('pads page number to 3 digits', () => {
        expect(buildPagePath('', '', 'Notebook', 9, 'png')).toBe('Notebook/Notebook-P010.png')
    })
})

describe('buildDocumentPath', () => {
    test('with target folder and folder path', () => {
        expect(buildDocumentPath('reMarkable', 'Work/Notes', 'Meeting', 'pdf')).toBe(
            'reMarkable/Work/Notes/Meeting.pdf'
        )
    })

    test('with empty target folder', () => {
        expect(buildDocumentPath('', 'Work', 'Meeting', 'pdf')).toBe('Work/Meeting.pdf')
    })

    test('with empty folder path', () => {
        expect(buildDocumentPath('reMarkable', '', 'Meeting', 'pdf')).toBe('reMarkable/Meeting.pdf')
    })

    test('sits beside the per-notebook image folder, never inside it', () => {
        const imagePath = buildPagePath('rM', 'Work', 'Meeting', 0, 'jpeg')
        const pdfPath = buildDocumentPath('rM', 'Work', 'Meeting', 'pdf')

        expect(imagePath).toBe('rM/Work/Meeting/Meeting-P001.jpeg')
        expect(pdfPath).toBe('rM/Work/Meeting.pdf')
        expect(imagePath.startsWith(pdfPath)).toBe(false)
    })
})

describe('buffersEqual', () => {
    test('identical content', () => {
        expect(buffersEqual(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(true)
    })

    test('different length', () => {
        expect(buffersEqual(bytes(1, 2, 3), bytes(1, 2))).toBe(false)
    })

    test('same length, different bytes', () => {
        expect(buffersEqual(bytes(1, 2, 3), bytes(1, 2, 4))).toBe(false)
    })

    test('difference in the first byte', () => {
        expect(buffersEqual(bytes(9, 2, 3), bytes(1, 2, 3))).toBe(false)
    })

    test('two empty buffers', () => {
        expect(buffersEqual(bytes(), bytes())).toBe(true)
    })
})

describe('writeBinaryIfChanged', () => {
    test('creates a file that does not exist yet', async () => {
        const { vault, calls } = createFakeVault()

        const written = await writeBinaryIfChanged(vault, 'out/page.jpeg', bytes(1, 2, 3))

        expect(written).toBe(true)
        expect(calls.created).toEqual(['out/page.jpeg'])
        expect(calls.modified).toEqual([])
        expect(calls.foldersCreated).toEqual(['out'])
    })

    test('skips the write when the bytes are identical', async () => {
        const { vault, calls } = createFakeVault({ 'out/page.jpeg': bytes(1, 2, 3) })

        const written = await writeBinaryIfChanged(vault, 'out/page.jpeg', bytes(1, 2, 3))

        expect(written).toBe(false)
        expect(calls.modified).toEqual([])
        expect(calls.created).toEqual([])
    })

    test('modifies the file when the bytes differ', async () => {
        const { vault, calls } = createFakeVault({ 'out/page.jpeg': bytes(1, 2, 3) })

        const written = await writeBinaryIfChanged(vault, 'out/page.jpeg', bytes(1, 2, 4))

        expect(written).toBe(true)
        expect(calls.modified).toEqual(['out/page.jpeg'])
    })

    test('overwrites when the existing file cannot be read', async () => {
        const { vault, calls } = createFakeVault({ 'out/page.jpeg': bytes(1) })
        // Force readBinary to fail while the path still resolves to a TFile.
        ;(vault as unknown as { readBinary: () => Promise<ArrayBuffer> }).readBinary = () =>
            Promise.reject(new Error('unreadable'))

        const written = await writeBinaryIfChanged(vault, 'out/page.jpeg', bytes(1))

        expect(written).toBe(true)
        expect(calls.modified).toEqual(['out/page.jpeg'])
    })
})

describe('writePageImage', () => {
    test('returns the path and writes on first run', async () => {
        const { vault, calls } = createFakeVault()

        const path = await writePageImage(vault, 'rM', 'Work', 'Meeting', 0, bytes(1, 2), 'jpeg')

        expect(path).toBe('rM/Work/Meeting/Meeting-P001.jpeg')
        expect(calls.created).toEqual(['rM/Work/Meeting/Meeting-P001.jpeg'])
    })

    test('a re-sync of unchanged content touches nothing', async () => {
        const { vault, calls } = createFakeVault({
            'rM/Work/Meeting/Meeting-P001.jpeg': bytes(1, 2)
        })

        await writePageImage(vault, 'rM', 'Work', 'Meeting', 0, bytes(1, 2), 'jpeg')

        expect(calls.created).toEqual([])
        expect(calls.modified).toEqual([])
    })
})

describe('writeDocumentPdf', () => {
    test('returns the path and writes on first run', async () => {
        const { vault, calls } = createFakeVault()

        const path = await writeDocumentPdf(vault, 'rM', 'Work', 'Meeting', bytes(1, 2))

        expect(path).toBe('rM/Work/Meeting.pdf')
        expect(calls.created).toEqual(['rM/Work/Meeting.pdf'])
    })

    test('a re-sync of an unchanged PDF touches nothing', async () => {
        const { vault, calls } = createFakeVault({ 'rM/Work/Meeting.pdf': bytes(1, 2) })

        await writeDocumentPdf(vault, 'rM', 'Work', 'Meeting', bytes(1, 2))

        expect(calls.created).toEqual([])
        expect(calls.modified).toEqual([])
    })

    test('rewrites when the notebook genuinely changed', async () => {
        const { vault, calls } = createFakeVault({ 'rM/Work/Meeting.pdf': bytes(1, 2) })

        await writeDocumentPdf(vault, 'rM', 'Work', 'Meeting', bytes(1, 2, 3))

        expect(calls.modified).toEqual(['rM/Work/Meeting.pdf'])
    })
})
