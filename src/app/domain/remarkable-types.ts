/**
 * reMarkable cloud document metadata from .metadata files inside ZIPs
 */
export interface RemarkableDocumentMetadata {
    readonly deleted: boolean
    readonly lastModified: string
    readonly lastOpened: string
    readonly lastOpenedPage: number
    readonly metadatamodified: boolean
    readonly modified: boolean
    readonly parent: string
    readonly pinned: boolean
    readonly synced: boolean
    readonly type: 'DocumentType' | 'CollectionType'
    readonly version: number
    readonly visibleName: string
}

/**
 * A page entry inside cPages (reMarkable firmware 3.x+)
 */
export interface RemarkableCPage {
    readonly id: string
    readonly idx?: { readonly value: string }
}

/**
 * The cPages structure used by reMarkable firmware 3.x+ for page ordering.
 * The idx.value fields use fractional indexing (lexicographic sort = display order).
 */
export interface RemarkableCPages {
    readonly pages?: readonly RemarkableCPage[]
}

/**
 * reMarkable .content file inside document ZIPs
 */
export interface RemarkableDocumentContent {
    readonly dpiScale: number
    readonly fileType: string
    readonly fontName: string
    readonly lastOpenedPage: number
    readonly lineHeight: number
    readonly margins: number
    readonly orientation: string
    readonly pageCount: number
    readonly pages: readonly string[]
    readonly cPages?: RemarkableCPages
    readonly textAlignment: string
    readonly textScale: number
    readonly customZoomCenterX?: number
    readonly customZoomCenterY?: number
    readonly customZoomPageHeight?: number
    readonly customZoomPageWidth?: number
    readonly customZoomScale?: number
}

/**
 * Entry from the reMarkable cloud document index
 */
export interface RemarkableCloudEntry {
    readonly id: string
    readonly hash: string
    readonly type: 'DocumentType' | 'CollectionType'
    readonly visibleName: string
    readonly parent: string
    readonly lastModified: string
    readonly version: number
}

/**
 * A folder in the reMarkable cloud hierarchy
 */
export interface RemarkableFolder {
    readonly id: string
    readonly visibleName: string
    readonly parent: string
    readonly children: readonly RemarkableCloudEntry[]
}
