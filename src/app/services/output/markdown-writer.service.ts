import type { Vault } from 'obsidian'
import { log } from '../../../utils/log'

/**
 * Build the full vault path for a page file
 */
export function buildPagePath(
    targetFolder: string,
    folderPath: string,
    notebookName: string,
    pageIndex: number,
    extension: string
): string {
    const pageNum = String(pageIndex + 1).padStart(3, '0')
    const fileName = `${notebookName}-P${pageNum}.${extension}`

    const parts: string[] = []
    if (targetFolder) {
        parts.push(targetFolder)
    }
    if (folderPath) {
        parts.push(folderPath)
    }
    parts.push(notebookName)
    parts.push(fileName)

    return parts.join('/')
}

/**
 * Write a page image to the vault
 */
export async function writePageImage(
    vault: Vault,
    targetFolder: string,
    folderPath: string,
    notebookName: string,
    pageIndex: number,
    imageData: ArrayBuffer,
    format: 'png' | 'jpeg'
): Promise<string> {
    const filePath = buildPagePath(targetFolder, folderPath, notebookName, pageIndex, format)

    // Ensure folder exists
    const folderParts = filePath.split('/')
    folderParts.pop()
    const folderFullPath = folderParts.join('/')

    if (folderFullPath) {
        try {
            const folder = vault.getAbstractFileByPath(folderFullPath)
            if (!folder) {
                await vault.createFolder(folderFullPath)
            }
        } catch {
            // Folder might already exist
        }
    }

    // Write binary data
    const existingFile = vault.getAbstractFileByPath(filePath)
    if (existingFile) {
        await vault.modifyBinary(existingFile as import('obsidian').TFile, imageData)
    } else {
        await vault.createBinary(filePath, imageData)
    }

    log(`Wrote image: ${filePath}`, 'debug')
    return filePath
}
