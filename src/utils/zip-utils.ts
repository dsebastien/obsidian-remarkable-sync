import JSZip from 'jszip'

/**
 * Extract all files from a ZIP buffer
 */
export async function extractZip(zipData: ArrayBuffer): Promise<Map<string, ArrayBuffer>> {
    const zip = await JSZip.loadAsync(zipData)
    const files = new Map<string, ArrayBuffer>()

    const entries = Object.entries(zip.files)
    for (const [path, zipEntry] of entries) {
        if (!zipEntry.dir) {
            const content = await zipEntry.async('arraybuffer')
            files.set(path, content)
        }
    }

    return files
}

/**
 * Extract a single file from a ZIP buffer by path
 */
export async function extractFileFromZip(
    zipData: ArrayBuffer,
    filePath: string
): Promise<ArrayBuffer | undefined> {
    const zip = await JSZip.loadAsync(zipData)
    const file = zip.file(filePath)
    if (!file) {
        return undefined
    }
    return file.async('arraybuffer')
}

/**
 * List all file paths in a ZIP buffer
 */
export async function listZipFiles(zipData: ArrayBuffer): Promise<string[]> {
    const zip = await JSZip.loadAsync(zipData)
    return Object.keys(zip.files).filter((path) => {
        const file = zip.files[path]
        return file !== undefined && !file.dir
    })
}
