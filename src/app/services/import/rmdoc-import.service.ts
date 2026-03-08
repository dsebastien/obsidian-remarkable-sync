import JSZip from 'jszip'
import { Notice } from 'obsidian'
import { log } from '../../../utils/log'
import type { RemarkableSyncPlugin } from '../../plugin'
import { pageHasContent } from '../parser/rm-file-parser'
import { parseDocument } from '../parser/document-parser.service'
import { renderPage } from '../renderer/page-renderer.service'
import { writePageImage } from '../output/markdown-writer.service'
import type { ProgressCallback } from '../pipeline/notebook-pipeline.service'

export interface RmdocImportService {
    processRmdocFile(
        fileBuffer: ArrayBuffer,
        fileName: string,
        onProgress: ProgressCallback
    ): Promise<boolean>
}

/**
 * Derive a notebook name from the .rmdoc file name.
 * Strips the .rmdoc extension.
 */
function deriveNotebookName(fileName: string): string {
    return fileName.replace(/\.rmdoc$/i, '')
}

/**
 * Extract files from a .rmdoc ZIP archive into the Map format
 * expected by parseDocument().
 */
async function extractRmdocFiles(fileBuffer: ArrayBuffer): Promise<Map<string, ArrayBuffer>> {
    const zip = await JSZip.loadAsync(fileBuffer)
    const files = new Map<string, ArrayBuffer>()

    const entries = Object.entries(zip.files)
    for (const [path, zipEntry] of entries) {
        if (zipEntry.dir) continue
        const data = await zipEntry.async('arraybuffer')
        files.set(path, data)
    }

    return files
}

export function createRmdocImportService(plugin: RemarkableSyncPlugin): RmdocImportService {
    async function processRmdocFile(
        fileBuffer: ArrayBuffer,
        fileName: string,
        onProgress: ProgressCallback
    ): Promise<boolean> {
        const { settings } = plugin
        const notebookName = deriveNotebookName(fileName)

        try {
            // Step 1: Extract ZIP
            onProgress({ status: 'parsing', currentPage: 0, totalPages: 0 })
            let files: Map<string, ArrayBuffer>
            try {
                files = await extractRmdocFiles(fileBuffer)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error'
                log(`Failed to extract .rmdoc file: ${fileName}`, 'error', error)
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: `Failed to extract archive: ${message}`
                })
                return false
            }

            if (files.size === 0) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Archive is empty'
                })
                return false
            }

            // Step 2: Parse
            // Use the file name as a synthetic document ID
            const documentId = `import-${notebookName}`
            const parsed = parseDocument(files, documentId)
            if (!parsed) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Failed to parse document'
                })
                return false
            }

            // Use the visibleName from metadata if available, otherwise fall back to file name
            const displayName = parsed.visibleName || notebookName

            // Filter out blank pages
            const contentPages = parsed.pages.filter(pageHasContent)

            if (contentPages.length === 0) {
                new Notice(`${displayName}: No pages with content found`)
                onProgress({ status: 'done', currentPage: 0, totalPages: 0 })
                return true
            }

            const totalPages = contentPages.length

            // Step 3: Render each page and write images
            for (let i = 0; i < contentPages.length; i++) {
                const page = contentPages[i]!
                const pageIndex = page.pageIndex

                onProgress({ status: 'rendering', currentPage: i + 1, totalPages })
                const imageData = await renderPage(
                    page,
                    settings.imageFormat,
                    settings.imageQuality
                )

                if (imageData && settings.saveImages) {
                    await writePageImage(
                        plugin.app.vault,
                        settings.targetFolder,
                        '', // No folder path for local imports
                        displayName,
                        pageIndex,
                        imageData,
                        settings.imageFormat
                    )
                }
            }

            onProgress({ status: 'done', currentPage: totalPages, totalPages })
            new Notice(`${displayName}: Imported ${totalPages} pages`)
            log(`Imported ${displayName} (${totalPages} pages) from .rmdoc file`, 'info')

            return true
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            log(`Import failed for ${notebookName}`, 'error', error)
            onProgress({ status: 'error', currentPage: 0, totalPages: 0, error: message })
            new Notice(`Error importing ${notebookName}: ${message}`)
            return false
        }
    }

    return { processRmdocFile }
}
