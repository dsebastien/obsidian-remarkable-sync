import { BinaryReader } from '../../../utils/binary-reader'
import {
    RM_HEADER,
    RM_HEADER_LENGTH,
    BLOCK_HEADER_SIZE,
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
    Highlight,
    HighlightRect,
    StrokeArgb
} from '../../domain/notebook'
import { log } from '../../../utils/log'

/**
 * Parse a .rm v6 binary file (rmscene format) into stroke data
 */
export function parseRmFile(buffer: ArrayBuffer, pageId: string, pageIndex: number): Page {
    const reader = new BinaryReader(buffer)
    const strokes: Stroke[] = []
    const highlights: Highlight[] = []

    // Validate header
    const header = reader.readString(RM_HEADER_LENGTH)
    if (!header.startsWith(RM_HEADER)) {
        if (header.startsWith('reMarkable .lines file, version=')) {
            const version = header.substring('reMarkable .lines file, version='.length).trim()
            log(`Unsupported .rm file version: ${version}`, 'warn')
        }
        throw new Error('Invalid .rm file header')
    }

    // Parse blocks until end of file
    while (reader.remaining >= BLOCK_HEADER_SIZE) {
        try {
            const { stroke, highlight } = parseBlock(reader)
            if (stroke) strokes.push(stroke)
            if (highlight) highlights.push(highlight)
        } catch (error) {
            log(`Error parsing .rm block at offset ${reader.position}`, 'warn', error)
            break
        }
    }

    return {
        pageId,
        pageIndex,
        strokes,
        ...(highlights.length > 0 ? { highlights } : {})
    }
}

/**
 * Block header: uint32 length | uint8 unknown | uint8 min_ver | uint8 cur_ver | uint8 type
 */
function parseBlock(reader: BinaryReader): { stroke?: Stroke; highlight?: Highlight } {
    const blockLength = reader.readUint32()
    reader.readUint8() // unknown, always 0
    reader.readUint8() // min_version
    const currentVersion = reader.readUint8()
    const blockType: BlockType = reader.readUint8()
    const blockEnd = reader.position + blockLength

    const result: { stroke?: Stroke; highlight?: Highlight } = {}

    if (blockType === BlockType.SceneLineItemBlock) {
        const stroke = parseSceneLineItemBlock(reader, currentVersion, blockEnd)
        if (stroke) result.stroke = stroke
    } else if (blockType === BlockType.SceneGlyphItemBlock) {
        const highlight = parseSceneGlyphItemBlock(reader, blockEnd)
        if (highlight) result.highlight = highlight
    }

    // Always seek to block end
    reader.seek(blockEnd)
    return result
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
 * Check if a page has any non-eraser strokes (i.e., is not blank)
 */
export function pageHasContent(page: Page): boolean {
    return page.strokes.some((stroke) => !ERASER_PEN_TYPES.has(stroke.penType))
}
