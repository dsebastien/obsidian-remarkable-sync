import { test, expect, describe } from 'bun:test'
import JSZip from 'jszip'
import { extractZip, extractFileFromZip, listZipFiles } from './zip-utils'

async function createTestZip(): Promise<ArrayBuffer> {
    const zip = new JSZip()
    zip.file('test.txt', 'hello world')
    zip.file('dir/nested.txt', 'nested content')
    return zip.generateAsync({ type: 'arraybuffer' })
}

describe('zip-utils', () => {
    test('extractZip extracts all files', async () => {
        const zipData = await createTestZip()
        const files = await extractZip(zipData)

        expect(files.size).toBe(2)
        expect(files.has('test.txt')).toBe(true)
        expect(files.has('dir/nested.txt')).toBe(true)

        const content = new TextDecoder().decode(files.get('test.txt'))
        expect(content).toBe('hello world')
    })

    test('extractFileFromZip extracts specific file', async () => {
        const zipData = await createTestZip()
        const data = await extractFileFromZip(zipData, 'test.txt')

        expect(data).toBeDefined()
        const content = new TextDecoder().decode(data)
        expect(content).toBe('hello world')
    })

    test('extractFileFromZip returns undefined for missing file', async () => {
        const zipData = await createTestZip()
        const data = await extractFileFromZip(zipData, 'nonexistent.txt')

        expect(data).toBeUndefined()
    })

    test('listZipFiles lists all file paths', async () => {
        const zipData = await createTestZip()
        const paths = await listZipFiles(zipData)

        expect(paths).toContain('test.txt')
        expect(paths).toContain('dir/nested.txt')
        expect(paths.length).toBe(2)
    })
})
