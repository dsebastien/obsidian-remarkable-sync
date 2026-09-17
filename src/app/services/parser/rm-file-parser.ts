import { BinaryReader } from '../../../utils/binary-reader'
import {
    RM_HEADER,
    RM_HEADER_LENGTH,
    BLOCK_HEADER_SIZE,
    ASSET_ID_LENGTH,
    LWW_VALUE_INDEX,
    IMAGE_VERTEX_STRIDE,
    BlockType,
    TagType,
    SceneItemType,
    ERASER_PEN_TYPES
} from '../../domain/rm-constants'
import type {
    PenType,
    Stroke,
    StrokeColor,
    StrokePoint,
    Page,
    PageImage,
    Highlight,
    HighlightRect,
    StrokeArgb
} from '../../domain/notebook'
import { END_MARKER } from '../../domain/text'
import type { CrdtId, PageText, TextItem, TextStyle, ParagraphStyle } from '../../domain/text'
import { hasText } from './text-sequence'
import { log } from '../../../utils/log'

/**
 * Parse a .rm v6 binary file (rmscene format) into stroke data
 */
export function parseRmFile(
    buffer: ArrayBuffer,
    pageId: string,
    pageIndex: number,
    assets?: ReadonlyMap<string, ArrayBuffer>
): Page {
    const reader = new BinaryReader(buffer)
    const strokes: Stroke[] = []
    let pageText: PageText | undefined
    const highlights: Highlight[] = []
    const assetsById = new Map<string, string>()
    const placements: ImagePlacement[] = []

    // Validate header
    const header = reader.readString(RM_HEADER_LENGTH)
    if (!header.startsWith(RM_HEADER)) {
        if (header.startsWith('reMarkable .lines file, version=')) {
            const version = header.substring('reMarkable .lines file, version='.length).trim()
            log(`Unsupported .rm file version: ${version}`, 'warn')
        }
        throw new Error('Invalid .rm file header')
    }

    // Parse blocks until end of file. One block we cannot read costs that
    // block only: `parseBlock` restores the stream to the block boundary, so
    // the rest of the page still parses.
    while (reader.remaining >= BLOCK_HEADER_SIZE) {
        const blockStart = reader.position
        try {
            const { stroke, highlight, text, imageAssets, placement } = parseBlock(reader)
            if (stroke) strokes.push(stroke)
            if (highlight) highlights.push(highlight)
            if (text) pageText = text
            if (imageAssets) {
                for (const asset of imageAssets) assetsById.set(asset.assetId, asset.fileName)
            }
            if (placement) placements.push(placement)
        } catch (error) {
            log(`Error parsing .rm block at offset ${blockStart}`, 'warn', error)
        }

        // Stop only when the block could not be stepped over at all, which
        // would otherwise re-read the same bytes forever.
        if (reader.position <= blockStart) {
            log(`Stopping .rm parse: no progress past offset ${blockStart}`, 'warn')
            break
        }
    }

    const images = resolveImages(placements, assetsById, assets)

    return {
        pageId,
        pageIndex,
        strokes,
        ...(images.length > 0 ? { images } : {}),
        ...(highlights.length > 0 ? { highlights } : {}),
        ...(pageText ? { text: pageText } : {})
    }
}

/** Declares which image file backs an asset id */
interface ImageAsset {
    readonly assetId: string
    readonly fileName: string
}

/** Where an image asset sits on the page, in stroke coordinate space */
interface ImagePlacement {
    readonly assetId: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** What a single block yielded, if anything */
interface BlockResult {
    stroke?: Stroke
    highlight?: Highlight
    text?: PageText
    imageAssets?: ImageAsset[]
    placement?: ImagePlacement
}

/**
 * Join placements to their asset declarations and to the image bytes.
 *
 * A placement whose asset id was never declared is dropped: without a file
 * name there is nothing to draw.
 */
function resolveImages(
    placements: readonly ImagePlacement[],
    assetsById: ReadonlyMap<string, string>,
    assets: ReadonlyMap<string, ArrayBuffer> | undefined
): PageImage[] {
    const images: PageImage[] = []
    let undeclared = 0
    let missingFile = 0

    for (const placement of placements) {
        const fileName = assetsById.get(placement.assetId)
        if (!fileName) {
            // One line per page, not per occurrence: the placement count comes
            // from the file, so a malformed page could otherwise emit tens of
            // thousands of warnings.
            if (undeclared === 0) {
                log(`Image placement references unknown asset ${placement.assetId}`, 'warn')
            }
            undeclared++
            continue
        }

        const data = assets?.get(fileName) ?? null
        if (!data) {
            if (missingFile === 0) {
                log(`Image asset file ${fileName} is missing from the document`, 'warn')
            }
            missingFile++
        }

        images.push({
            assetId: placement.assetId,
            fileName,
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: placement.height,
            data
        })
    }

    if (undeclared > 1) {
        log(`${undeclared} image placements referenced assets this page never declared`, 'warn')
    }
    if (missingFile > 1) {
        log(`${missingFile} image assets were missing from the document`, 'warn')
    }

    return images
}

/**
 * Block header: uint32 length | uint8 unknown | uint8 min_ver | uint8 cur_ver | uint8 type
 */
function parseBlock(reader: BinaryReader): BlockResult {
    const blockLength = reader.readUint32()
    reader.readUint8() // unknown, always 0
    reader.readUint8() // min_version
    const currentVersion = reader.readUint8()
    const blockType: BlockType = reader.readUint8()
    const blockEnd = reader.position + blockLength

    const result: BlockResult = {}

    try {
        if (blockType === BlockType.RootTextBlock) {
            const text = parseRootTextBlock(reader, blockEnd)
            if (text) result.text = text
        } else if (blockType === BlockType.SceneLineItemBlock) {
            const stroke = parseSceneLineItemBlock(reader, currentVersion, blockEnd)
            if (stroke) result.stroke = stroke
        } else if (blockType === BlockType.SceneGlyphItemBlock) {
            const highlight = parseSceneGlyphItemBlock(reader, blockEnd)
            if (highlight) result.highlight = highlight
        } else if (blockType === BlockType.SceneImageInfoBlock) {
            const imageAssets = parseSceneImageInfoBlock(reader, blockEnd)
            if (imageAssets.length > 0) result.imageAssets = imageAssets
        } else if (blockType === BlockType.SceneImageItemBlock) {
            const placement = parseSceneImageItemBlock(reader, blockEnd)
            if (placement) result.placement = placement
        }
    } finally {
        // Seek to block end even when the body threw. The block length is the
        // only thing keeping the stream in sync, so a block we failed to
        // understand must still cost exactly its declared length. Without this
        // one bad block discarded every block after it, and on a capture page
        // the image blocks sit ahead of every stroke, so a single unexpected
        // field took the page's whole handwriting with it.
        if (blockEnd <= reader.length) {
            reader.seek(blockEnd)
        }
    }

    return result
}

/**
 * Read a rmscene string: varuint length | uint8 is_ascii | bytes
 */
function readRmString(reader: BinaryReader, end: number): string | null {
    const length = reader.readVarUint()
    if (length < 0 || reader.position + 1 + length > end) {
        return null
    }
    reader.readUint8() // is_ascii flag, not trustworthy enough to branch on
    return reader.readUtf8String(length)
}

/** Read a 16-byte asset id as lowercase hex */
function readAssetId(reader: BinaryReader): string {
    const bytes = reader.readBytes(ASSET_ID_LENGTH)
    let hex = ''
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, '0')
    }
    return hex
}

/**
 * Advance to the value of the Length4 subblock tagged `index`, returning where
 * that value ends. Leaves the reader at the start of the value; returns null
 * when no such subblock is present before `end`.
 *
 * This is the only place the subblock bounds clamp lives. Every field in these
 * blocks is reached through here so a length that overruns its parent cannot
 * be read past, and so there is one implementation to get right rather than
 * one per call site.
 *
 * Always consumes at least five bytes before returning a value, which is what
 * guarantees callers that loop over repeated subblocks make progress.
 */
function readSubblock(reader: BinaryReader, end: number, index: number): number | null {
    while (reader.position < end) {
        const tag = readTag(reader)
        if (tag.type === TagType.Length4) {
            const length = reader.readUint32()
            const valueEnd = Math.min(reader.position + length, end)
            if (tag.index === index) {
                return valueEnd
            }
            reader.seek(valueEnd)
            continue
        }
        skipTagValue(reader, tag.type)
    }
    return null
}

/**
 * Read an LWW string: a timestamp id at index 1, the string itself at index 2.
 */
function readLwwString(reader: BinaryReader, entryEnd: number): string | null {
    const end = readSubblock(reader, entryEnd, LWW_VALUE_INDEX)
    return end === null ? null : readRmString(reader, end)
}

/**
 * Parse a SceneImageInfoBlock (0x0e), which declares every image asset the
 * page uses.
 *
 * Layout, matching rmscene's block of the same name (ricklupton/rmscene#52):
 *
 *     tag 1 Length4                     the declaration list
 *       varuint                         number of declarations
 *       tag 0 Length4                   one per declaration
 *         16 raw bytes                  asset id (untagged)
 *         tag 1 Length4                 LWW file name
 *         tag 2 Length4                 LWW flags, observed [17, 0], unused
 *
 * The count is authoritative for how many declarations to expect, but the
 * subblock walk is what actually bounds the read.
 */
function parseSceneImageInfoBlock(reader: BinaryReader, blockEnd: number): ImageAsset[] {
    const listEnd = readSubblock(reader, blockEnd, 1)
    if (listEnd === null) return []
    if (listEnd - reader.position < 1) return []

    const declaredCount = reader.readVarUint()

    const assets: ImageAsset[] = []
    while (reader.position < listEnd) {
        const entryEnd = readSubblock(reader, listEnd, 0)
        if (entryEnd === null) break

        const asset = parseImageAssetEntry(reader, entryEnd)
        reader.seek(entryEnd)
        if (asset) assets.push(asset)
    }

    if (assets.length < declaredCount) {
        log(
            `Image info block declared ${declaredCount} image(s) but only ${assets.length} parsed`,
            'warn'
        )
    }

    return assets
}

/**
 * Parse one asset declaration: the raw asset id, then its LWW file name at
 * index 1. Index 2 carries flags (observed `[17, 0]`) this parser does not need.
 */
function parseImageAssetEntry(reader: BinaryReader, entryEnd: number): ImageAsset | null {
    if (entryEnd - reader.position < ASSET_ID_LENGTH) return null
    const assetId = readAssetId(reader)

    const nameEnd = readSubblock(reader, entryEnd, 1)
    const fileName = nameEnd === null ? null : readLwwString(reader, nameEnd)

    if (!fileName) {
        log(`Image asset ${assetId} has no file name`, 'warn')
        return null
    }

    return { assetId, fileName }
}

/**
 * Parse a SceneImageItemBlock (0x0f). Same CRDT item envelope as
 * `SceneLineItemBlock`: the value lives in tag 6, and a non-zero tag 5 marks
 * the item deleted.
 */
function parseSceneImageItemBlock(reader: BinaryReader, blockEnd: number): ImagePlacement | null {
    while (reader.position < blockEnd) {
        const tag = readTag(reader)

        if (tag.type === TagType.Length4 && tag.index === 6) {
            const subLen = reader.readUint32()
            const subEnd = Math.min(reader.position + subLen, blockEnd)
            const placement = parseImageValue(reader, subEnd)
            reader.seek(subEnd)
            return placement
        }

        if (tag.type === TagType.Byte4 && tag.index === 5) {
            const deletedFlag = reader.readInt32()
            if (deletedFlag !== 0) {
                return null
            }
            continue
        }

        skipTagValue(reader, tag.type)
    }

    return null
}

/**
 * Parse the image value inside a CRDT item subblock.
 *
 *     uint8                             scene item type, 7 for Image
 *     tag 1 Length4                     LWW asset reference (id at index 2)
 *     tag 2 ID                          anchor
 *     tag 3 Length4                     varuint float count | float32[]
 *                                       vertices as x, y, u, v
 *     tag 4 Length4                     varuint index count | uint32[]
 *                                       triangle indices, not needed here
 */
function parseImageValue(reader: BinaryReader, subEnd: number): ImagePlacement | null {
    const sceneType: SceneItemType = reader.readUint8()
    if (sceneType !== SceneItemType.Image) {
        return null
    }

    let assetId: string | null = null
    let vertices: number[] = []

    while (reader.position < subEnd) {
        const tag = readTag(reader)

        if (tag.type !== TagType.Length4) {
            skipTagValue(reader, tag.type)
            continue
        }

        const length = reader.readUint32()
        const end = Math.min(reader.position + length, subEnd)

        switch (tag.index) {
            case 1:
                assetId = readAssetIdFromReference(reader, end)
                break
            case 3:
                vertices = readVertexBuffer(reader, end)
                break
            default:
                break
        }

        reader.seek(end)
    }

    if (!assetId || vertices.length < IMAGE_VERTEX_STRIDE) {
        return null
    }

    return boundsFromVertices(assetId, vertices)
}

/**
 * Read the asset id out of an image item's asset reference.
 *
 * The reference is an LWW value, so the id is the value at index 2, the same
 * shape as the LWW file name in the info block. Reading it structurally rather
 * than scanning for "the first 16-byte subblock" matters: any 16-byte field a
 * later firmware adds ahead of it would otherwise be taken as the asset id,
 * which resolves to an unknown asset and silently drops the image.
 */
function readAssetIdFromReference(reader: BinaryReader, end: number): string | null {
    const valueEnd = readSubblock(reader, end, LWW_VALUE_INDEX)
    if (valueEnd === null) return null
    if (valueEnd - reader.position !== ASSET_ID_LENGTH) {
        log(`Image asset reference is ${valueEnd - reader.position} bytes, expected 16`, 'warn')
        return null
    }
    return readAssetId(reader)
}

/**
 * Read the vertex buffer: a varuint count of float32 values, then the values.
 *
 * The declared count is treated as advisory for bounds — the subblock length is
 * authoritative, so a future firmware that adds a trailing field cannot make us
 * read past the end — but a short or non-whole read is rejected rather than
 * half-used.
 */
function readVertexBuffer(reader: BinaryReader, end: number): number[] {
    const declaredCount = reader.readVarUint()
    const available = Math.floor((end - reader.position) / 4)
    const count = Math.min(declaredCount, available)

    const values: number[] = []
    for (let i = 0; i < count; i++) {
        values.push(reader.readFloat32())
    }

    // A short read means the subblock did not hold what it said it did, and a
    // count that is not a whole number of vertices means the layout is not the
    // one we decode. Either way the floats are not (x, y, u, v) tuples, and
    // taking a bounding box from them would place the image somewhere
    // plausible-looking but wrong. Better to drop the image than to move it.
    if (count < declaredCount) {
        log(`Image vertex buffer declared ${declaredCount} floats but held ${count}`, 'warn')
        return []
    }
    if (count % IMAGE_VERTEX_STRIDE !== 0) {
        log(`Image vertex buffer has ${count} floats, not a whole number of vertices`, 'warn')
        return []
    }

    return values
}

/**
 * The uv coordinates of an unrotated, uncropped quad, in vertex order.
 * Anything else means the renderer's bounding-box placement is wrong.
 */
const CANONICAL_QUAD_UV = [0, 0, 1, 0, 1, 1, 0, 1]

/** Report a placement this renderer would draw wrongly rather than doing it quietly */
function warnIfNotCanonicalQuad(vertices: readonly number[]): void {
    if (vertices.length !== CANONICAL_QUAD_UV.length * 2) return

    for (let vertex = 0; vertex * IMAGE_VERTEX_STRIDE < vertices.length; vertex++) {
        const u = vertices[vertex * IMAGE_VERTEX_STRIDE + 2]
        const v = vertices[vertex * IMAGE_VERTEX_STRIDE + 3]
        if (u !== CANONICAL_QUAD_UV[vertex * 2] || v !== CANONICAL_QUAD_UV[vertex * 2 + 1]) {
            log(
                'Image placement is rotated or cropped; it will be drawn upright and uncropped',
                'warn'
            )
            return
        }
    }
}

/**
 * Axis-aligned bounds of the placement quad.
 *
 * Only the (x, y) half of each vertex is used. Every quad observed on a device
 * is axis-aligned with uv spanning the full 0..1, so the bounding box is the
 * placement.
 */
function boundsFromVertices(assetId: string, vertices: readonly number[]): ImagePlacement | null {
    warnIfNotCanonicalQuad(vertices)

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (let i = 0; i + 1 < vertices.length; i += IMAGE_VERTEX_STRIDE) {
        const x = vertices[i]
        const y = vertices[i + 1]
        if (x === undefined || y === undefined) continue
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }

    const width = maxX - minX
    const height = maxY - minY
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null
    }

    return { assetId, x: minX, y: minY, width, height }
}

/**
 * Parse a SceneGlyphItemBlock, which carries a text highlight.
 *
 * These are produced when text is selected on the device and highlighted, as
 * opposed to ink drawn with the highlighter pen. The device stores the selected
 * text itself along with the rectangles covering it, so nothing has to be
 * inferred from stroke geometry.
 *
 * Wire format inside the CRDT item's value subblock:
 *   uint8 scene item type (1 = GlyphRange)
 *   tag 2  Byte4      start   (optional, absent since firmware 3.6)
 *   tag 3  Byte4      length  (optional, absent since firmware 3.6)
 *   tag 4  Byte4      colour
 *   tag 5  Length4    string subblock: varuint length, bool ascii flag, bytes
 *   tag 6  Length4    subblock: varuint count, then count * 4 float64 (x, y, w, h)
 */
function parseSceneGlyphItemBlock(reader: BinaryReader, blockEnd: number): Highlight | null {
    while (reader.position < blockEnd) {
        const tag = readTag(reader)

        if (tag.type === TagType.Length4 && tag.index === 6) {
            const subLen = reader.readUint32()
            const subEnd = reader.position + subLen
            const highlight = parseGlyphValue(reader, subEnd)
            reader.seek(subEnd)
            return highlight
        }

        // Deleted item (tag index 5, Byte4, non-zero)
        if (tag.type === TagType.Byte4 && tag.index === 5) {
            if (reader.readInt32() !== 0) return null
            continue
        }

        skipTagValue(reader, tag.type)
    }

    return null
}

function parseGlyphValue(reader: BinaryReader, subEnd: number): Highlight | null {
    const sceneType: SceneItemType = reader.readUint8()
    if (sceneType !== SceneItemType.GlyphRange) {
        return null
    }

    let text = ''
    let color: StrokeColor = 0
    let argb: StrokeArgb | undefined
    const rects: HighlightRect[] = []

    while (reader.position < subEnd) {
        const tag = readTag(reader)

        if (tag.index === 4 && tag.type === TagType.Byte4) {
            color = reader.readInt32() as StrokeColor
            continue
        }

        if (tag.index === 5 && tag.type === TagType.Length4) {
            const len = reader.readUint32()
            const end = reader.position + len
            const strLen = reader.readVarUint()
            reader.readUint8() // ascii flag, unused: the bytes are decoded as UTF-8
            // Highlighted text can contain any character the source PDF holds,
            // so this is decoded as UTF-8 rather than through the ASCII-only
            // `readString` used for the file header.
            text = new TextDecoder().decode(
                reader.readBytes(Math.min(strLen, end - reader.position))
            )
            reader.seek(end)
            continue
        }

        if (tag.index === 6 && tag.type === TagType.Length4) {
            const len = reader.readUint32()
            const end = reader.position + len
            const count = reader.readVarUint()
            for (let i = 0; i < count && reader.position + 32 <= end; i++) {
                rects.push({
                    x: reader.readFloat64(),
                    y: reader.readFloat64(),
                    width: reader.readFloat64(),
                    height: reader.readFloat64()
                })
            }
            reader.seek(end)
            continue
        }

        // Tag 10 carries the highlight's own BGRA colour. Note that the
        // condition is the mirror of a stroke's: a stroke has tag 8 when its
        // colour id is 9, but a glyph range has tag 10 when its colour id is
        // *below* 9. Both mean the same thing, that the palette is not the
        // answer here.
        if (tag.index === 10 && tag.type === TagType.Byte4) {
            const blue = reader.readUint8()
            const green = reader.readUint8()
            const red = reader.readUint8()
            const alpha = reader.readUint8()
            argb = { red, green, blue, alpha }
            continue
        }

        skipTagValue(reader, tag.type)
    }

    if (!text) {
        return null
    }

    return { text, color, rects, ...(argb ? { argb } : {}) }
}

/**
 * Read a tag: varuint encoding (index << 4) | tag_type
 */
function readTag(reader: BinaryReader): { index: number; type: TagType } {
    const raw = reader.readVarUint()
    return {
        index: raw >> 4,
        type: raw & 0x0f
    }
}

/**
 * Read a CrdtId: uint8 (author) + varuint (counter)
 */
function readCrdtId(reader: BinaryReader): CrdtId {
    const author = reader.readUint8()
    const counter = reader.readVarUint()
    return { author, counter }
}

/**
 * Read a tag that must be an ID, returning the end marker if it is not.
 */
function readIdTag(reader: BinaryReader, index: number): CrdtId {
    const tag = readTag(reader)
    if (tag.index !== index || tag.type !== TagType.ID) {
        skipTagValue(reader, tag.type)
        return END_MARKER
    }
    return readCrdtId(reader)
}

/**
 * Open a length-prefixed subblock, returning where it ends.
 */
function openSubBlock(reader: BinaryReader, index: number): number | null {
    const tag = readTag(reader)
    if (tag.index !== index || tag.type !== TagType.Length4) {
        skipTagValue(reader, tag.type)
        return null
    }
    // The length must be read before the position is taken: `position +
    // readUint32()` evaluates the left operand first and lands four bytes
    // short, which derails every nested block after it.
    const length = reader.readUint32()
    return reader.position + length
}

/**
 * Parse a RootTextBlock, which carries the page's typed text.
 *
 * Structure, from `RootTextBlock::read` in librm_lines:
 *
 *   tag 1 ID        block id, always 0:0
 *   tag 2 subblock  tag 1 subblock, twice nested
 *                     varuint item count, then that many text items
 *                   tag 2 then tag 1 subblock
 *                     varuint style count, then that many styles
 *                   tag 3 subblock
 *                     double posX, double posY, tag 4 float width
 *
 * Anything unreadable returns null rather than throwing: a page whose text we
 * cannot decode must still render its ink.
 */
function parseRootTextBlock(reader: BinaryReader, blockEnd: number): PageText | null {
    try {
        readIdTag(reader, 1)

        const sectionEnd = openSubBlock(reader, 2)
        if (null === sectionEnd) return null

        // Two nested subblocks, both tagged 1, then the item count
        if (null === openSubBlock(reader, 1)) return null
        if (null === openSubBlock(reader, 1)) return null

        const itemCount = reader.readVarUint()
        const items: TextItem[] = []
        for (let i = 0; i < itemCount && reader.position < blockEnd; i++) {
            const item = readTextItem(reader)
            if (item) items.push(item)
        }

        // Formatting: subblock 2 then subblock 1, then the style count
        if (null === openSubBlock(reader, 2)) return { items, styles: [], x: 0, y: 0, width: 0 }
        if (null === openSubBlock(reader, 1)) return { items, styles: [], x: 0, y: 0, width: 0 }

        const styleCount = reader.readVarUint()
        const styles: TextStyle[] = []
        for (let i = 0; i < styleCount && reader.position < blockEnd; i++) {
            const style = readTextStyle(reader)
            if (style) styles.push(style)
        }

        // Position and column width
        let x = 0
        let y = 0
        let width = 0
        if (null !== openSubBlock(reader, 3) && reader.position + 16 <= blockEnd) {
            x = reader.readFloat64()
            y = reader.readFloat64()
            const tag = readTag(reader)
            if (tag.index === 4 && tag.type === TagType.Byte4) {
                width = reader.readFloat32()
            } else {
                skipTagValue(reader, tag.type)
            }
        }

        return { items, styles, x, y, width }
    } catch (error) {
        log('Could not read the typed text on a page', 'warn', error)
        return null
    }
}

/**
 * One text item: its id, the positions it was inserted between, how much of it
 * has been deleted, and its characters.
 *
 * Tag 6 is optional and may hold either a string or a uint32 format marker. An
 * item with neither is a pure tombstone.
 */
function readTextItem(reader: BinaryReader): TextItem | null {
    const itemEnd = openSubBlock(reader, 0)
    if (null === itemEnd) return null

    const itemId = readIdTag(reader, 2)
    const leftId = readIdTag(reader, 3)
    const rightId = readIdTag(reader, 4)

    let deletedLength = 0
    const delTag = readTag(reader)
    if (delTag.index === 5 && delTag.type === TagType.Byte4) {
        deletedLength = reader.readUint32()
    } else {
        skipTagValue(reader, delTag.type)
    }

    let text: string | undefined
    let formatMarker: number | undefined
    if (reader.position < itemEnd) {
        const tag = readTag(reader)
        if (tag.index === 6 && tag.type === TagType.Length4) {
            const subLen = reader.readUint32()
            const subEnd = reader.position + subLen
            const strLen = reader.readVarUint()
            reader.readUint8() // ascii flag, unused: decoded as UTF-8 regardless
            text = new TextDecoder().decode(
                reader.readBytes(Math.min(strLen, Math.max(0, subEnd - reader.position)))
            )
            reader.seek(subEnd)
        } else if (tag.index === 6 && tag.type === TagType.Byte4) {
            formatMarker = reader.readUint32()
        } else {
            skipTagValue(reader, tag.type)
        }
    }

    reader.seek(itemEnd)
    return {
        itemId,
        leftId,
        rightId,
        deletedLength,
        ...(undefined !== text ? { text } : {}),
        ...(undefined !== formatMarker ? { formatMarker } : {})
    }
}

/**
 * One paragraph style: the character id it starts at, then a subblock holding
 * a marker byte of 17 and the style itself.
 */
function readTextStyle(reader: BinaryReader): TextStyle | null {
    const startId = readCrdtId(reader)
    readIdTag(reader, 1) // timestamp, unused

    const end = openSubBlock(reader, 2)
    if (null === end) return null

    reader.readUint8() // marker, always 17
    const style = reader.readUint8() as ParagraphStyle
    reader.seek(end)

    return { startId, style }
}

/**
 * Skip a CrdtId: uint8 (author) + varuint (counter)
 */
function skipCrdtId(reader: BinaryReader): void {
    reader.readUint8()
    reader.readVarUint()
}

/**
 * Skip a tagged value based on its type
 */
function skipTagValue(reader: BinaryReader, tagType: TagType): number {
    switch (tagType) {
        case TagType.ID:
            skipCrdtId(reader)
            return 0
        case TagType.Byte1:
            return reader.readUint8()
        case TagType.Byte4: {
            const val = reader.readUint32()
            return val
        }
        case TagType.Byte8:
            reader.skip(8)
            return 0
        case TagType.Length4: {
            const len = reader.readUint32()
            reader.skip(len)
            return len
        }
    }
}

/**
 * Parse a SceneLineItemBlock containing one CRDT line item
 */
function parseSceneLineItemBlock(
    reader: BinaryReader,
    version: number,
    blockEnd: number
): Stroke | null {
    // Read CRDT item tags until we find the value subblock (tag index 6, Length4)
    while (reader.position < blockEnd) {
        const tag = readTag(reader)

        if (tag.type === TagType.Length4 && tag.index === 6) {
            // Value subblock found
            const subLen = reader.readUint32()
            const subEnd = reader.position + subLen
            const stroke = parseLineValue(reader, subEnd, version)
            reader.seek(subEnd)
            return stroke
        }

        // Check if item is deleted (tag index 5, Byte4, non-zero = deleted)
        if (tag.type === TagType.Byte4 && tag.index === 5) {
            const deletedFlag = reader.readInt32()
            if (deletedFlag !== 0) {
                return null
            }
            continue
        }

        // Skip other tags
        skipTagValue(reader, tag.type)
    }

    return null
}

/**
 * Parse the line value inside a CRDT item subblock
 */
function parseLineValue(reader: BinaryReader, subEnd: number, version: number): Stroke | null {
    // Scene item type byte (3 = Line)
    const sceneType: SceneItemType = reader.readUint8()
    if (sceneType !== SceneItemType.Line) {
        return null
    }

    let toolId: PenType = 0
    let colorId: StrokeColor = 0
    let thickness = 1.0
    let points: StrokePoint[] = []
    let argb: StrokeArgb | undefined

    // Read tagged fields
    while (reader.position < subEnd) {
        const tag = readTag(reader)

        switch (tag.index) {
            case 1: // tool_id (Byte4)
                if (tag.type === TagType.Byte4) {
                    toolId = reader.readInt32()
                } else {
                    skipTagValue(reader, tag.type)
                }
                break
            case 2: // color_id (Byte4)
                if (tag.type === TagType.Byte4) {
                    colorId = reader.readInt32()
                } else {
                    skipTagValue(reader, tag.type)
                }
                break
            case 3: // thickness_scale (Byte8)
                if (tag.type === TagType.Byte8) {
                    thickness = reader.readFloat64()
                } else {
                    skipTagValue(reader, tag.type)
                }
                break
            case 4: // starting_length (Byte4)
                if (tag.type === TagType.Byte4) {
                    reader.skip(4) // not used for rendering
                } else {
                    skipTagValue(reader, tag.type)
                }
                break
            case 5: // points subblock (Length4)
                if (tag.type === TagType.Length4) {
                    const pointsLen = reader.readUint32()
                    if (version !== 1 && version !== 2) {
                        // Known versions are 1 and 2; anything else would repeat
                        // the silent-garbage failure mode fixed for v1 blocks.
                        log(
                            `Unknown SceneLineItemBlock version ${version}, assuming v2 point format`,
                            'warn'
                        )
                    }
                    points =
                        version === 1
                            ? parsePointsV1(reader, pointsLen)
                            : parsePointsV2(reader, pointsLen)
                } else {
                    skipTagValue(reader, tag.type)
                }
                break
            case 8: // per-stroke colour (Byte4, BGRA little-endian)
                if (tag.type === TagType.Byte4) {
                    // Written by tools whose colour is freely chosen rather
                    // than picked from the palette. `color` is 9 in that case,
                    // which is a marker rather than a colour, so without this
                    // the renderer falls back to a guess and loses the alpha.
                    const blue = reader.readUint8()
                    const green = reader.readUint8()
                    const red = reader.readUint8()
                    const alpha = reader.readUint8()
                    argb = { red, green, blue, alpha }
                } else {
                    skipTagValue(reader, tag.type)
                }
                break
            default:
                // Skip unknown tags (timestamp, move_id, etc.)
                skipTagValue(reader, tag.type)
                break
        }
    }

    if (points.length === 0) {
        return null
    }

    return {
        ...(argb ? { argb } : {}),
        penType: toolId,
        color: colorId,
        thickness,
        points
    }
}

/**
 * Parse v1 point data: 24 bytes per point (version 1 SceneLineItemBlocks,
 * written by older reMarkable firmware)
 * float32 x, float32 y, float32 speed, float32 direction, float32 width, float32 pressure
 * Values are already in natural units (direction in radians, pressure 0..1),
 * unlike v2 where they are packed integers that need scaling.
 */
function parsePointsV1(reader: BinaryReader, totalBytes: number): StrokePoint[] {
    const bytesPerPoint = 24
    const numPoints = Math.floor(totalBytes / bytesPerPoint)
    const points: StrokePoint[] = []

    for (let i = 0; i < numPoints; i++) {
        const x = reader.readFloat32()
        const y = reader.readFloat32()
        const speed = reader.readFloat32()
        const direction = reader.readFloat32()
        const width = reader.readFloat32()
        const pressure = reader.readFloat32()

        points.push({ x, y, speed, width, direction, pressure })
    }

    // Skip any remaining bytes (e.g., if totalBytes isn't a perfect multiple)
    const consumed = numPoints * bytesPerPoint
    if (consumed < totalBytes) {
        reader.skip(totalBytes - consumed)
    }

    return points
}

/**
 * Parse v2 point data: 14 bytes per point
 * float32 x, float32 y, uint16 speed, uint16 width, uint8 direction, uint8 pressure
 */
function parsePointsV2(reader: BinaryReader, totalBytes: number): StrokePoint[] {
    const bytesPerPoint = 14
    const numPoints = Math.floor(totalBytes / bytesPerPoint)
    const points: StrokePoint[] = []

    for (let i = 0; i < numPoints; i++) {
        const x = reader.readFloat32()
        const y = reader.readFloat32()
        const speedRaw = reader.readUint16()
        const widthRaw = reader.readUint16()
        const directionRaw = reader.readUint8()
        const pressureRaw = reader.readUint8()

        points.push({
            x,
            y,
            speed: speedRaw / 4.0,
            width: widthRaw / 4.0,
            direction: directionRaw * ((Math.PI * 2) / 255),
            pressure: pressureRaw / 255.0
        })
    }

    // Skip any remaining bytes (e.g., if totalBytes isn't a perfect multiple)
    const consumed = numPoints * bytesPerPoint
    if (consumed < totalBytes) {
        reader.skip(totalBytes - consumed)
    }

    return points
}

/**
 * Whether a page carries anything worth writing out.
 *
 * Ink, a text highlight, typed text, or a captured image all count. Typed text
 * especially: a page written entirely on the Type Folio has no strokes at all,
 * and testing only for strokes silently dropped it, so a wholly typed notebook
 * synced as "no pages with content found" and wrote nothing.
 *
 * One of three places that must agree on what a page holds, alongside
 * `computePageBounds` (which sizes the canvas) and `renderPageToCanvas` (which
 * decides a page drew nothing). This one and the bounds check can only see
 * that an image has bytes; only the renderer learns whether they decode.
 */
export function pageHasContent(page: Page): boolean {
    if (pageHasNonImageContent(page)) return true
    // A page can carry only a capture and no ink at all. Counting strokes
    // alone dropped those pages from the output entirely (issue #36).
    return page.images?.some((image) => image.data !== null) ?? false
}

/**
 * Whether a page carries anything other than captured images.
 *
 * The renderer needs this to tell two blank pages apart: one written entirely
 * on the Type Folio, whose blank ink layer is correct, and one whose only
 * content was a capture that failed to decode, which must not be written at
 * all. Kept beside `pageHasContent` so the two cannot drift.
 */
export function pageHasNonImageContent(page: Page): boolean {
    if (page.strokes.some((stroke) => !ERASER_PEN_TYPES.has(stroke.penType))) return true
    if ((page.highlights?.length ?? 0) > 0) return true
    return hasText(page.text)
}
