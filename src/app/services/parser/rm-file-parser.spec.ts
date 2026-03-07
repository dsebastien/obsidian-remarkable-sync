import { test, expect, describe } from 'bun:test'
import { parseRmFile, pageHasContent } from './rm-file-parser'
import { RM_HEADER, RM_HEADER_LENGTH, BlockType, SceneItemType } from '../../domain/rm-constants'
import { PenType, StrokeColor } from '../../domain/notebook'

/**
 * Helper to build binary buffers matching the rmscene v6 format
 */
class RmFileBuilder {
    private parts: Uint8Array[] = []

    /** Write the 43-byte v6 header */
    writeHeader(): this {
        const buf = new Uint8Array(RM_HEADER_LENGTH)
        const encoded = new TextEncoder().encode(RM_HEADER)
        buf.set(encoded)
        // Remaining bytes are 0 (space padding handled by the header string itself)
        this.parts.push(buf)
        return this
    }

    /** Write a block: uint32 length | uint8 unknown(0) | uint8 min_ver | uint8 cur_ver | uint8 type | data */
    writeBlock(blockType: number, data: Uint8Array, minVer = 0, curVer = 2): this {
        const header = new Uint8Array(8)
        const dv = new DataView(header.buffer)
        dv.setUint32(0, data.length, true)
        header[4] = 0 // unknown
        header[5] = minVer
        header[6] = curVer
        header[7] = blockType
        this.parts.push(header)
        this.parts.push(data)
        return this
    }

    build(): ArrayBuffer {
        const totalLen = this.parts.reduce((sum, p) => sum + p.length, 0)
        const result = new Uint8Array(totalLen)
        let offset = 0
        for (const part of this.parts) {
            result.set(part, offset)
            offset += part.length
        }
        return result.buffer
    }
}

/**
 * Build the data payload for a SceneLineItemBlock
 */
function buildLineItemData(opts: {
    toolId?: number
    colorId?: number
    thickness?: number
    points?: Array<{
        x: number
        y: number
        speed?: number
        width?: number
        direction?: number
        pressure?: number
    }>
    deleted?: boolean
    sceneType?: number
}): Uint8Array {
    const {
        toolId = PenType.FinelinerV2,
        colorId = StrokeColor.Black,
        thickness = 2.0,
        points = [],
        deleted = false,
        sceneType = SceneItemType.Line
    } = opts

    // Build points data (14 bytes per point)
    const pointsData = new Uint8Array(points.length * 14)
    const pointsDv = new DataView(pointsData.buffer)
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!
        const off = i * 14
        pointsDv.setFloat32(off, p.x, true)
        pointsDv.setFloat32(off + 4, p.y, true)
        pointsDv.setUint16(off + 8, Math.round((p.speed ?? 1.0) * 4), true)
        pointsDv.setUint16(off + 10, Math.round((p.width ?? 2.0) * 4), true)
        pointsData[off + 12] = Math.round(((p.direction ?? 0) * 255) / (Math.PI * 2))
        pointsData[off + 13] = Math.round((p.pressure ?? 1.0) * 255)
    }

    // Build value subblock content (scene type + tagged fields + points subblock)
    const valueContent: number[] = []
    valueContent.push(sceneType) // scene item type

    // Tag 1 (Byte4): tool_id → 0x14
    valueContent.push(0x14)
    pushInt32(valueContent, toolId)

    // Tag 2 (Byte4): color_id → 0x24
    valueContent.push(0x24)
    pushInt32(valueContent, colorId)

    // Tag 3 (Byte8): thickness → 0x38
    valueContent.push(0x38)
    pushFloat64(valueContent, thickness)

    // Tag 4 (Byte4): starting_length → 0x44
    valueContent.push(0x44)
    pushFloat32(valueContent, 0)

    // Tag 5 (Length4): points → 0x5C
    valueContent.push(0x5c)
    pushUint32(valueContent, pointsData.length)
    for (const b of pointsData) valueContent.push(b)

    const valueBytes = new Uint8Array(valueContent)

    // Build CRDT item header + value subblock
    const blockContent: number[] = []

    // Tag 1 (ID=0xF): item_id → 0x1F, CrdtId(0, 1)
    blockContent.push(0x1f, 0x00, 0x01)
    // Tag 2 (ID=0xF): left_id → 0x2F, CrdtId(0, 0)
    blockContent.push(0x2f, 0x00, 0x00)
    // Tag 3 (ID=0xF): right_id → 0x3F, CrdtId(0, 0)
    blockContent.push(0x3f, 0x00, 0x00)
    // Tag 4 (ID=0xF): ref → 0x4F, CrdtId(0, 0)
    blockContent.push(0x4f, 0x00, 0x00)

    // Tag 5 (Byte4): deleted flag → 0x54
    blockContent.push(0x54)
    pushInt32(blockContent, deleted ? 1 : 0)

    if (!deleted) {
        // Tag 6 (Length4): value subblock → 0x6C
        blockContent.push(0x6c)
        pushUint32(blockContent, valueBytes.length)
        for (const b of valueBytes) blockContent.push(b)
    }

    return new Uint8Array(blockContent)
}

function pushUint32(arr: number[], val: number): void {
    arr.push(val & 0xff, (val >> 8) & 0xff, (val >> 16) & 0xff, (val >> 24) & 0xff)
}

function pushInt32(arr: number[], val: number): void {
    const buf = new ArrayBuffer(4)
    new DataView(buf).setInt32(0, val, true)
    const bytes = new Uint8Array(buf)
    for (const b of bytes) arr.push(b)
}

function pushFloat32(arr: number[], val: number): void {
    const buf = new ArrayBuffer(4)
    new DataView(buf).setFloat32(0, val, true)
    const bytes = new Uint8Array(buf)
    for (const b of bytes) arr.push(b)
}

function pushFloat64(arr: number[], val: number): void {
    const buf = new ArrayBuffer(8)
    new DataView(buf).setFloat64(0, val, true)
    const bytes = new Uint8Array(buf)
    for (const b of bytes) arr.push(b)
}

describe('rm-file-parser', () => {
    describe('parseRmFile', () => {
        test('throws on invalid header', () => {
            const buffer = new ArrayBuffer(RM_HEADER_LENGTH)
            const view = new Uint8Array(buffer)
            view.set(new TextEncoder().encode('invalid header content'))

            expect(() => parseRmFile(buffer, 'test-page', 0)).toThrow('Invalid .rm file header')
        })

        test('throws on unsupported version', () => {
            const buffer = new ArrayBuffer(RM_HEADER_LENGTH)
            const view = new Uint8Array(buffer)
            view.set(new TextEncoder().encode('reMarkable .lines file, version=3'))

            expect(() => parseRmFile(buffer, 'test-page', 0)).toThrow('Invalid .rm file header')
        })

        test('parses empty file with valid header', () => {
            const buffer = new RmFileBuilder().writeHeader().build()
            const page = parseRmFile(buffer, 'test-page', 0)

            expect(page.pageId).toBe('test-page')
            expect(page.pageIndex).toBe(0)
            expect(page.strokes).toHaveLength(0)
        })

        test('returns correct page metadata', () => {
            const buffer = new RmFileBuilder().writeHeader().build()
            const page = parseRmFile(buffer, 'page-abc', 5)

            expect(page.pageId).toBe('page-abc')
            expect(page.pageIndex).toBe(5)
        })

        test('skips non-LineItem blocks', () => {
            const dummyData = new Uint8Array([0x01, 0x02, 0x03, 0x04])
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.AuthorIdsBlock, dummyData)
                .writeBlock(BlockType.PageInfoBlock, dummyData)
                .writeBlock(BlockType.SceneTreeBlock, dummyData)
                .writeBlock(BlockType.MigrationInfoBlock, dummyData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(0)
        })

        test('parses a single stroke with one point', () => {
            const lineData = buildLineItemData({
                toolId: PenType.FinelinerV2,
                colorId: StrokeColor.Black,
                thickness: 2.0,
                points: [{ x: 100.5, y: 200.75 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(1)

            const stroke = page.strokes[0]!
            expect(stroke.penType).toBe(PenType.FinelinerV2)
            expect(stroke.color).toBe(StrokeColor.Black)
            expect(stroke.thickness).toBe(2.0)
            expect(stroke.points).toHaveLength(1)
            expect(stroke.points[0]!.x).toBeCloseTo(100.5, 1)
            expect(stroke.points[0]!.y).toBeCloseTo(200.75, 1)
        })

        test('parses multiple points in a stroke', () => {
            const lineData = buildLineItemData({
                points: [
                    { x: 10, y: 20 },
                    { x: 30, y: 40 },
                    { x: 50, y: 60 }
                ]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(1)
            expect(page.strokes[0]!.points).toHaveLength(3)
            expect(page.strokes[0]!.points[0]!.x).toBeCloseTo(10, 0)
            expect(page.strokes[0]!.points[1]!.x).toBeCloseTo(30, 0)
            expect(page.strokes[0]!.points[2]!.x).toBeCloseTo(50, 0)
        })

        test('parses multiple strokes from multiple blocks', () => {
            const line1 = buildLineItemData({
                toolId: PenType.BallPointV2,
                colorId: StrokeColor.Blue,
                points: [{ x: 100, y: 200 }]
            })
            const line2 = buildLineItemData({
                toolId: PenType.Highlighter,
                colorId: StrokeColor.Yellow,
                points: [{ x: 300, y: 400 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, line1)
                .writeBlock(BlockType.SceneLineItemBlock, line2)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(2)
            expect(page.strokes[0]!.penType).toBe(PenType.BallPointV2)
            expect(page.strokes[0]!.color).toBe(StrokeColor.Blue)
            expect(page.strokes[1]!.penType).toBe(PenType.Highlighter)
            expect(page.strokes[1]!.color).toBe(StrokeColor.Yellow)
        })

        test('skips deleted CRDT items', () => {
            const deletedLine = buildLineItemData({
                deleted: true,
                points: [{ x: 100, y: 200 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, deletedLine)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(0)
        })

        test('skips non-Line scene types (Group)', () => {
            const groupItem = buildLineItemData({
                sceneType: SceneItemType.Group,
                points: [{ x: 100, y: 200 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, groupItem)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(0)
        })

        test('skips strokes with no points', () => {
            const emptyLine = buildLineItemData({ points: [] })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, emptyLine)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(0)
        })

        test('mixes LineItem blocks with other block types', () => {
            const dummyData = new Uint8Array([0x01, 0x02])
            const lineData = buildLineItemData({
                toolId: PenType.Brush,
                points: [{ x: 50, y: 100 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.AuthorIdsBlock, dummyData)
                .writeBlock(BlockType.MigrationInfoBlock, dummyData)
                .writeBlock(BlockType.SceneLineItemBlock, lineData)
                .writeBlock(BlockType.PageInfoBlock, dummyData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(1)
            expect(page.strokes[0]!.penType).toBe(PenType.Brush)
        })

        test('preserves pen attributes', () => {
            const lineData = buildLineItemData({
                toolId: PenType.CalligraphyPen,
                colorId: StrokeColor.Red,
                thickness: 3.5,
                points: [{ x: 10, y: 20 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            const stroke = page.strokes[0]!
            expect(stroke.penType).toBe(PenType.CalligraphyPen)
            expect(stroke.color).toBe(StrokeColor.Red)
            expect(stroke.thickness).toBe(3.5)
        })
    })

    describe('point conversion', () => {
        test('converts speed from raw uint16 (divided by 4)', () => {
            const lineData = buildLineItemData({
                points: [{ x: 0, y: 0, speed: 5.25 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes[0]!.points[0]!.speed).toBeCloseTo(5.25, 1)
        })

        test('converts width from raw uint16 (divided by 4)', () => {
            const lineData = buildLineItemData({
                points: [{ x: 0, y: 0, width: 4.5 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes[0]!.points[0]!.width).toBeCloseTo(4.5, 1)
        })

        test('converts pressure from raw uint8 (divided by 255)', () => {
            const lineData = buildLineItemData({
                points: [{ x: 0, y: 0, pressure: 1.0 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes[0]!.points[0]!.pressure).toBeCloseTo(1.0, 2)
        })

        test('converts direction from raw uint8 to radians', () => {
            const lineData = buildLineItemData({
                points: [{ x: 0, y: 0, direction: Math.PI }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            // uint8 precision: round-trip through 255 quantization levels
            expect(page.strokes[0]!.points[0]!.direction).toBeCloseTo(Math.PI, 1)
        })
    })

    describe('pageHasContent', () => {
        test('returns true for page with non-eraser strokes', () => {
            const page = {
                pageId: 'test',
                pageIndex: 0,
                strokes: [
                    {
                        penType: PenType.FinelinerV2,
                        color: StrokeColor.Black,
                        thickness: 1,
                        points: []
                    }
                ]
            }
            expect(pageHasContent(page)).toBe(true)
        })

        test('returns false for page with only eraser strokes', () => {
            const page = {
                pageId: 'test',
                pageIndex: 0,
                strokes: [
                    { penType: PenType.Eraser, color: StrokeColor.Black, thickness: 1, points: [] },
                    {
                        penType: PenType.EraseArea,
                        color: StrokeColor.Black,
                        thickness: 1,
                        points: []
                    }
                ]
            }
            expect(pageHasContent(page)).toBe(false)
        })

        test('returns false for page with no strokes', () => {
            const page = { pageId: 'test', pageIndex: 0, strokes: [] }
            expect(pageHasContent(page)).toBe(false)
        })

        test('returns true if any stroke is non-eraser', () => {
            const page = {
                pageId: 'test',
                pageIndex: 0,
                strokes: [
                    { penType: PenType.Eraser, color: StrokeColor.Black, thickness: 1, points: [] },
                    {
                        penType: PenType.BallPoint,
                        color: StrokeColor.Black,
                        thickness: 1,
                        points: []
                    }
                ]
            }
            expect(pageHasContent(page)).toBe(true)
        })
    })
})
