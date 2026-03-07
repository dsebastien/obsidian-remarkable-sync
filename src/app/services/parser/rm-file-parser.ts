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
import { PenType, StrokeColor } from '../../domain/notebook'
import type { Stroke, StrokePoint, Page } from '../../domain/notebook'
import { log } from '../../../utils/log'

/**
 * Parse a .rm v6 binary file (rmscene format) into stroke data
 */
export function parseRmFile(buffer: ArrayBuffer, pageId: string, pageIndex: number): Page {
    const reader = new BinaryReader(buffer)
    const strokes: Stroke[] = []

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
            const stroke = parseBlock(reader)
            if (stroke) {
                strokes.push(stroke)
            }
        } catch (error) {
            log(`Error parsing .rm block at offset ${reader.position}`, 'warn', error)
            break
        }
    }

    return {
        pageId,
        pageIndex,
        strokes
    }
}

/**
 * Block header: uint32 length | uint8 unknown | uint8 min_ver | uint8 cur_ver | uint8 type
 */
function parseBlock(reader: BinaryReader): Stroke | null {
    const blockLength = reader.readUint32()
    reader.readUint8() // unknown, always 0
    reader.readUint8() // min_version
    const currentVersion = reader.readUint8()
    const blockType = reader.readUint8()
    const blockEnd = reader.position + blockLength

    let stroke: Stroke | null = null

    if (blockType === BlockType.SceneLineItemBlock) {
        stroke = parseSceneLineItemBlock(reader, currentVersion, blockEnd)
    }

    // Always seek to block end
    reader.seek(blockEnd)
    return stroke
}

/**
 * Read a tag: varuint encoding (index << 4) | tag_type
 */
function readTag(reader: BinaryReader): { index: number; type: TagType } {
    const raw = reader.readVarUint()
    return {
        index: raw >> 4,
        type: (raw & 0x0f) as TagType
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
    _version: number,
    blockEnd: number
): Stroke | null {
    // Read CRDT item tags until we find the value subblock (tag index 6, Length4)
    while (reader.position < blockEnd) {
        const tag = readTag(reader)

        if (tag.type === TagType.Length4 && tag.index === 6) {
            // Value subblock found
            const subLen = reader.readUint32()
            const subEnd = reader.position + subLen
            const stroke = parseLineValue(reader, subEnd)
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
function parseLineValue(reader: BinaryReader, subEnd: number): Stroke | null {
    // Scene item type byte (3 = Line)
    const sceneType = reader.readUint8()
    if (sceneType !== SceneItemType.Line) {
        return null
    }

    let toolId = 0
    let colorId = 0
    let thickness = 1.0
    let points: StrokePoint[] = []

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
                    points = parsePointsV2(reader, pointsLen)
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
        penType: toolId as PenType,
        color: colorId as StrokeColor,
        thickness,
        points
    }
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
