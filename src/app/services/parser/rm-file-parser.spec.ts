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

    /** Declare the page's image assets (block 0x0e) */
    writeAssets(images: AssetSpec[], declaredCountOverride?: number): this {
        const data = buildImageAssetData({ images, declaredCountOverride })
        return this.writeBlock(BlockType.SceneImageInfoBlock, data, 3, 3)
    }

    /** Place one declared asset on the page (block 0x0f) */
    writeImage(opts: ImageItemOpts): this {
        return this.writeBlock(BlockType.SceneImageItemBlock, buildImageItemData(opts))
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
    pointVersion?: 1 | 2
}): Uint8Array {
    const {
        toolId = PenType.FinelinerV2,
        colorId = StrokeColor.Black,
        thickness = 2.0,
        points = [],
        deleted = false,
        sceneType = SceneItemType.Line,
        pointVersion = 2
    } = opts

    let pointsData: Uint8Array
    if (pointVersion === 1) {
        // v1: 24 bytes per point, six float32s in natural units
        pointsData = new Uint8Array(points.length * 24)
        const pointsDv = new DataView(pointsData.buffer)
        for (let i = 0; i < points.length; i++) {
            const p = points[i]!
            const off = i * 24
            pointsDv.setFloat32(off, p.x, true)
            pointsDv.setFloat32(off + 4, p.y, true)
            pointsDv.setFloat32(off + 8, p.speed ?? 1.0, true)
            pointsDv.setFloat32(off + 12, p.direction ?? 0, true)
            pointsDv.setFloat32(off + 16, p.width ?? 2.0, true)
            pointsDv.setFloat32(off + 20, p.pressure ?? 1.0, true)
        }
    } else {
        // v2: 14 bytes per point, packed integers
        pointsData = new Uint8Array(points.length * 14)
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

/** One image declaration inside an asset block */
interface AssetSpec {
    assetId: Uint8Array
    fileName: string
    omitFileName?: boolean
}

/** One image placement */
interface ImageItemOpts {
    assetId: Uint8Array
    x?: number
    y?: number
    width?: number
    height?: number
    deleted?: boolean
    sceneType?: number
    vertices?: number[]
}

/**
 * Build the data payload for a SceneImageInfoBlock (0x0e), which declares which
 * file backs each asset id used by the page.
 *
 * Mirrors rmscene's `SceneImageInfoBlock`: a varuint count followed by one
 * subblock per declaration.
 */
function buildImageAssetData(opts: {
    images: AssetSpec[]
    declaredCountOverride?: number
}): Uint8Array {
    const { images, declaredCountOverride } = opts

    const list: number[] = []
    list.push(declaredCountOverride ?? images.length) // varuint count

    for (const { assetId, fileName, omitFileName = false } of images) {
        // LWW file name: tag 1 ID (timestamp), then tag 2 Length4 (the string).
        const lwwName: number[] = []
        lwwName.push(0x1f, 0x01, 0x11)
        const encoded = new TextEncoder().encode(fileName)
        lwwName.push(0x2c)
        pushUint32(lwwName, encoded.length + 2)
        lwwName.push(encoded.length) // varuint string length
        lwwName.push(0x01) // is_ascii
        for (const b of encoded) lwwName.push(b)

        // LWW flags, observed as [17, 0] on a real device. Parsed past.
        const lwwFlags: number[] = []
        lwwFlags.push(0x1f, 0x00, 0x00)
        lwwFlags.push(0x2c)
        pushUint32(lwwFlags, 2)
        lwwFlags.push(0x11, 0x00)

        const entry: number[] = []
        for (const b of assetId) entry.push(b)
        if (!omitFileName) {
            entry.push(0x1c) // tag 1 Length4
            pushUint32(entry, lwwName.length)
            for (const b of lwwName) entry.push(b)
        }
        entry.push(0x2c) // tag 2 Length4
        pushUint32(entry, lwwFlags.length)
        for (const b of lwwFlags) entry.push(b)

        list.push(0x0c) // tag 0 Length4, one per declaration
        pushUint32(list, entry.length)
        for (const b of entry) list.push(b)
    }

    // Block body: tag 1 Length4 holding the declaration list.
    const body: number[] = []
    body.push(0x1c)
    pushUint32(body, list.length)
    for (const b of list) body.push(b)

    return new Uint8Array(body)
}

/**
 * Build the data payload for a SceneImageItemBlock (0x0f), which places an
 * asset on the page as a textured quad.
 */
function buildImageItemData(opts: ImageItemOpts): Uint8Array {
    const {
        assetId,
        x = -100,
        y = 200,
        width = 400,
        height = 300,
        deleted = false,
        sceneType = SceneItemType.Image
    } = opts

    // Four vertices as x, y, u, v — the quad the capture tool writes.
    const vertices = opts.vertices ?? [
        x,
        y,
        0,
        0,
        x + width,
        y,
        1,
        0,
        x + width,
        y + height,
        1,
        1,
        x,
        y + height,
        0,
        1
    ]

    const valueContent: number[] = []
    valueContent.push(sceneType)

    // Tag 1 (Length4): asset reference → id tag plus the raw asset id.
    const reference: number[] = []
    reference.push(0x1f, 0x01, 0x16) // tag 1 ID
    reference.push(0x2c) // tag 2 Length4
    pushUint32(reference, assetId.length)
    for (const b of assetId) reference.push(b)
    valueContent.push(0x1c)
    pushUint32(valueContent, reference.length)
    for (const b of reference) valueContent.push(b)

    // Tag 2 (ID): anchor
    valueContent.push(0x2f, 0x01, 0x15)

    // Tag 3 (Length4): vertex buffer → varuint float count, then float32s.
    const vertexBuffer: number[] = []
    vertexBuffer.push(vertices.length)
    for (const v of vertices) pushFloat32(vertexBuffer, v)
    valueContent.push(0x3c)
    pushUint32(valueContent, vertexBuffer.length)
    for (const b of vertexBuffer) valueContent.push(b)

    // Tag 4 (Length4): triangle indices, ignored by the parser.
    const indices: number[] = []
    indices.push(6)
    for (const i of [0, 1, 2, 2, 3, 0]) pushUint32(indices, i)
    valueContent.push(0x4c)
    pushUint32(valueContent, indices.length)
    for (const b of indices) valueContent.push(b)

    const valueBytes = new Uint8Array(valueContent)

    // Same CRDT item envelope as a line item.
    const blockContent: number[] = []
    blockContent.push(0x1f, 0x00, 0x0b) // tag 1 ID: parent
    blockContent.push(0x2f, 0x01, 0x14) // tag 2 ID: item id
    blockContent.push(0x3f, 0x01, 0x13) // tag 3 ID: left
    blockContent.push(0x4f, 0x00, 0x00) // tag 4 ID: right
    blockContent.push(0x54)
    pushInt32(blockContent, deleted ? 1 : 0)

    if (!deleted) {
        blockContent.push(0x6c)
        pushUint32(blockContent, valueBytes.length)
        for (const b of valueBytes) blockContent.push(b)
    }

    return new Uint8Array(blockContent)
}

/** A distinct 16-byte asset id for tests */
function assetIdBytes(seed: number): Uint8Array {
    return new Uint8Array(Array.from({ length: 16 }, (_, i) => (seed + i) & 0xff))
}

/** A page declaring one asset and placing it once: the common case */
function onePageWith(seed: number, fileName = 'capture.png', place: Partial<ImageItemOpts> = {}) {
    return new RmFileBuilder()
        .writeHeader()
        .writeAssets([{ assetId: assetIdBytes(seed), fileName }])
        .writeImage({ assetId: assetIdBytes(seed), ...place })
        .build()
}

/** An asset map holding one file */
function oneAsset(fileName = 'capture.png', bytes = 8) {
    return new Map([[fileName, new ArrayBuffer(bytes)]])
}

/** Same id rendered the way the parser reports it */
function assetIdHex(seed: number): string {
    return Array.from(assetIdBytes(seed))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
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

    describe('version 1 blocks (24-byte float points)', () => {
        test('parses v1 points from a version-1 SceneLineItemBlock', () => {
            const lineData = buildLineItemData({
                toolId: PenType.FinelinerV2,
                colorId: StrokeColor.Black,
                thickness: 2.0,
                pointVersion: 1,
                points: [
                    {
                        x: 100.5,
                        y: 200.75,
                        speed: 3.5,
                        direction: Math.PI / 2,
                        width: 2.25,
                        pressure: 0.8
                    },
                    { x: 150, y: 250 }
                ]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData, 1, 1)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(1)

            const stroke = page.strokes[0]!
            expect(stroke.points).toHaveLength(2)
            expect(stroke.points[0]!.x).toBeCloseTo(100.5, 2)
            expect(stroke.points[0]!.y).toBeCloseTo(200.75, 2)
            expect(stroke.points[0]!.speed).toBeCloseTo(3.5, 2)
            expect(stroke.points[0]!.direction).toBeCloseTo(Math.PI / 2, 3)
            expect(stroke.points[0]!.width).toBeCloseTo(2.25, 2)
            expect(stroke.points[0]!.pressure).toBeCloseTo(0.8, 2)
            expect(stroke.points[1]!.x).toBeCloseTo(150, 1)
            expect(stroke.points[1]!.y).toBeCloseTo(250, 1)
        })

        test('v1 points parsed as v2 would produce garbage — regression guard', () => {
            // A v1 block misread with the 14-byte stride yields coordinates far outside
            // the page (this is the bug: bounds near FLT_MAX crash OffscreenCanvas).
            // With the fix, coordinates stay within the drawn range.
            const points = Array.from({ length: 10 }, (_, i) => ({
                x: 100 + i * 10,
                y: 200 + i * 5
            }))
            const lineData = buildLineItemData({ pointVersion: 1, points })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData, 1, 1)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(1)
            for (const p of page.strokes[0]!.points) {
                expect(Math.abs(p.x)).toBeLessThan(2000)
                expect(Math.abs(p.y)).toBeLessThan(2000)
            }
        })

        test('version 2 blocks still parse with the packed 14-byte format', () => {
            const lineData = buildLineItemData({
                pointVersion: 2,
                points: [{ x: 42, y: 84 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData, 0, 2)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(1)
            expect(page.strokes[0]!.points[0]!.x).toBeCloseTo(42, 1)
            expect(page.strokes[0]!.points[0]!.y).toBeCloseTo(84, 1)
        })

        test('unknown block versions fall back to the v2 point format', () => {
            const lineData = buildLineItemData({
                pointVersion: 2,
                points: [{ x: 42, y: 84 }]
            })

            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, lineData, 0, 3)
                .build()

            const page = parseRmFile(buffer, 'test', 0)
            expect(page.strokes).toHaveLength(1)
            expect(page.strokes[0]!.points[0]!.x).toBeCloseTo(42, 1)
            expect(page.strokes[0]!.points[0]!.y).toBeCloseTo(84, 1)
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

    describe('capture tool images (issue #36)', () => {
        test('parses an asset block and its placement into a page image', () => {
            const png = new ArrayBuffer(8)
            const buffer = onePageWith(1, 'capture.png', {
                x: -100,
                y: 200,
                width: 400,
                height: 300
            })

            const image = parseRmFile(buffer, 'test', 0, new Map([['capture.png', png]]))
                .images![0]!

            expect(image.fileName).toBe('capture.png')
            expect(image.assetId).toBe(assetIdHex(1))
            expect([image.x, image.y, image.width, image.height]).toEqual([-100, 200, 400, 300])
            expect(image.data).toBe(png)
        })

        test('keeps the image but reports no data when the file is missing', () => {
            // The placement still tells the caller the page is not blank, just
            // incompletely downloaded.
            const images =
                parseRmFile(onePageWith(2, 'gone.png'), 'test', 0, new Map()).images ?? []

            expect(images).toHaveLength(1)
            expect(images[0]!.data).toBeNull()
        })

        test('drops a placement whose asset was never declared', () => {
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeImage({ assetId: assetIdBytes(3) })
                .build()

            expect(parseRmFile(buffer, 'test', 0).images ?? []).toHaveLength(0)
        })

        test('ignores a deleted placement', () => {
            const buffer = onePageWith(4, 'capture.png', { deleted: true })

            expect(parseRmFile(buffer, 'test', 0, oneAsset()).images ?? []).toHaveLength(0)
        })

        test('ignores an asset declaration with no file name', () => {
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeAssets([{ assetId: assetIdBytes(5), fileName: 'x.png', omitFileName: true }])
                .writeImage({ assetId: assetIdBytes(5) })
                .build()

            expect(parseRmFile(buffer, 'test', 0).images ?? []).toHaveLength(0)
        })

        test('ignores a scene item that is not an image', () => {
            const buffer = onePageWith(6, 'capture.png', { sceneType: SceneItemType.Group })

            expect(parseRmFile(buffer, 'test', 0, oneAsset()).images ?? []).toHaveLength(0)
        })

        test('ignores a degenerate quad', () => {
            // Zero area renders nothing and would drag the canvas bounds around.
            const flat = [10, 10, 0, 0, 10, 10, 1, 0, 10, 10, 1, 1, 10, 10, 0, 1]
            const buffer = onePageWith(7, 'capture.png', { vertices: flat })

            expect(parseRmFile(buffer, 'test', 0, oneAsset()).images ?? []).toHaveLength(0)
        })

        test('parses strokes and images from the same page', () => {
            const line = buildLineItemData({
                points: [
                    { x: 10, y: 20 },
                    { x: 30, y: 40 }
                ]
            })
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeAssets([{ assetId: assetIdBytes(8), fileName: 'capture.png' }])
                .writeImage({ assetId: assetIdBytes(8) })
                .writeBlock(BlockType.SceneLineItemBlock, line)
                .build()

            const page = parseRmFile(buffer, 'test', 0, oneAsset())

            expect(page.images ?? []).toHaveLength(1)
            expect(page.strokes).toHaveLength(1)
        })

        test('reads every declaration in one asset block', () => {
            // rmscene's SceneImageInfoBlock is a varuint count followed by one
            // subblock per image. Reading only the first silently dropped every
            // capture after it on a multi-image page.
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeAssets([
                    { assetId: assetIdBytes(9), fileName: 'one.png' },
                    { assetId: assetIdBytes(40), fileName: 'two.png' },
                    { assetId: assetIdBytes(80), fileName: 'three.png' }
                ])
                .writeImage({ assetId: assetIdBytes(9) })
                .writeImage({ assetId: assetIdBytes(40) })
                .writeImage({ assetId: assetIdBytes(80) })
                .build()

            const assets = new Map([
                ['one.png', new ArrayBuffer(8)],
                ['two.png', new ArrayBuffer(16)],
                ['three.png', new ArrayBuffer(24)]
            ])
            const images = parseRmFile(buffer, 'test', 0, assets).images ?? []

            expect(images.map((i) => i.fileName)).toEqual(['one.png', 'two.png', 'three.png'])
            expect(images.map((i) => i.data?.byteLength)).toEqual([8, 16, 24])
        })

        test('survives a declared count larger than the declarations present', () => {
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeAssets([{ assetId: assetIdBytes(11), fileName: 'one.png' }], 4)
                .writeImage({ assetId: assetIdBytes(11) })
                .build()

            expect(parseRmFile(buffer, 'test', 0, oneAsset('one.png')).images ?? []).toHaveLength(1)
        })

        test('resolves a JPEG asset, not just PNG', () => {
            const buffer = onePageWith(12, 'capture.jpg')
            const images = parseRmFile(buffer, 'test', 0, oneAsset('capture.jpg')).images ?? []

            expect(images[0]!.fileName).toBe('capture.jpg')
            expect(images[0]!.data).not.toBeNull()
        })

        test('a bad image block costs that block only, not the rest of the page', () => {
            // The info block sits ahead of every stroke in a real capture
            // document, so when a throw there aborted the block loop it took
            // the page's whole handwriting with it.
            const line = buildLineItemData({
                points: [
                    { x: 1, y: 2 },
                    { x: 3, y: 4 }
                ]
            })
            // Tag 7 Length4 with a length that runs past the block, which the
            // unbounded skip path follows straight off the end.
            const corrupt = new Uint8Array([0x7c, 0xff, 0xff, 0xff, 0x7f])
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneImageItemBlock, corrupt)
                .writeBlock(BlockType.SceneLineItemBlock, line)
                .writeBlock(BlockType.SceneLineItemBlock, line)
                .build()

            const page = parseRmFile(buffer, 'test', 0)

            expect(page.images ?? []).toHaveLength(0)
            expect(page.strokes).toHaveLength(2)
        })

        test('a bad stroke block likewise costs only that block', () => {
            const line = buildLineItemData({
                points: [
                    { x: 1, y: 2 },
                    { x: 3, y: 4 }
                ]
            })
            const corrupt = new Uint8Array([0x7c, 0xff, 0xff, 0xff, 0x7f])
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, corrupt)
                .writeBlock(BlockType.SceneLineItemBlock, line)
                .build()

            expect(parseRmFile(buffer, 'test', 0).strokes).toHaveLength(1)
        })

        test('rejects a vertex buffer that is not whole vertices', () => {
            // Not (x, y, u, v) tuples means the layout is not the one we
            // decode, so a bounding box from it would place the image wrongly
            // rather than not at all.
            const buffer = onePageWith(13, 'capture.png', { vertices: [1, 2, 3, 4, 5, 6] })

            expect(parseRmFile(buffer, 'test', 0, oneAsset()).images ?? []).toHaveLength(0)
        })

        test('reads a non-ASCII file name as UTF-8', () => {
            // The name is the join key to the archive, so mojibake here shows
            // up as a capture that is present but reported missing.
            const buffer = onePageWith(14, 'café.png')
            const images = parseRmFile(buffer, 'test', 0, oneAsset('café.png')).images ?? []

            expect(images[0]!.fileName).toBe('café.png')
            expect(images[0]!.data).not.toBeNull()
        })

        test('a page with no images still parses', () => {
            const line = buildLineItemData({ points: [{ x: 1, y: 2 }] })
            const buffer = new RmFileBuilder()
                .writeHeader()
                .writeBlock(BlockType.SceneLineItemBlock, line)
                .build()

            expect(parseRmFile(buffer, 'test', 0).images ?? []).toEqual([])
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
