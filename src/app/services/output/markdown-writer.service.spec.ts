import { test, expect, describe } from 'bun:test'
import type { Vault } from 'obsidian'
import { buildPagePath, vaultFileExists } from './markdown-writer.service'

describe('markdown-writer.service', () => {
    test('buildPagePath with target folder and folder path', () => {
        const path = buildPagePath('reMarkable', 'Work/Notes', 'Meeting', 0, 'md')
        expect(path).toBe('reMarkable/Work/Notes/Meeting/Meeting-P001.md')
    })

    test('buildPagePath with empty target folder', () => {
        const path = buildPagePath('', 'Work', 'Meeting', 0, 'md')
        expect(path).toBe('Work/Meeting/Meeting-P001.md')
    })

    test('buildPagePath with empty folder path', () => {
        const path = buildPagePath('reMarkable', '', 'Meeting', 0, 'md')
        expect(path).toBe('reMarkable/Meeting/Meeting-P001.md')
    })

    test('buildPagePath pads page number to 3 digits', () => {
        const path = buildPagePath('', '', 'Notebook', 9, 'png')
        expect(path).toBe('Notebook/Notebook-P010.png')
    })

    test('vaultFileExists true when the vault resolves the path to a file', () => {
        const vault = {
            getFileByPath: (path: string) => (path === 'a/b.png' ? {} : null)
        } as unknown as Vault
        expect(vaultFileExists(vault, 'a/b.png')).toBe(true)
    })

    test('vaultFileExists false when the vault has no file at the path', () => {
        const vault = { getFileByPath: () => null } as unknown as Vault
        expect(vaultFileExists(vault, 'missing.png')).toBe(false)
    })
})
