import { test, expect, describe } from 'bun:test'
import { BinaryReader } from './binary-reader'

describe('BinaryReader', () => {
    function createBuffer(bytes: number[]): ArrayBuffer {
        return new Uint8Array(bytes).buffer
    }

    test('reads uint8', () => {
        const reader = new BinaryReader(createBuffer([0x42, 0xff]))
        expect(reader.readUint8()).toBe(0x42)
        expect(reader.readUint8()).toBe(0xff)
    })

    test('reads uint16 little-endian', () => {
        const reader = new BinaryReader(createBuffer([0x01, 0x02]))
        expect(reader.readUint16()).toBe(0x0201)
    })

    test('reads uint32 little-endian', () => {
        const reader = new BinaryReader(createBuffer([0x01, 0x00, 0x00, 0x00]))
        expect(reader.readUint32()).toBe(1)
    })

    test('reads int32 little-endian', () => {
        const reader = new BinaryReader(createBuffer([0xff, 0xff, 0xff, 0xff]))
        expect(reader.readInt32()).toBe(-1)
    })

    test('reads float32', () => {
        const buffer = new ArrayBuffer(4)
        new DataView(buffer).setFloat32(0, 3.14, true)
        const reader = new BinaryReader(buffer)
        expect(reader.readFloat32()).toBeCloseTo(3.14, 2)
    })

    test('reads string', () => {
        const reader = new BinaryReader(createBuffer([0x48, 0x69]))
        expect(reader.readString(2)).toBe('Hi')
    })

    test('tracks position', () => {
        const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03, 0x04]))
        expect(reader.position).toBe(0)
        reader.readUint8()
        expect(reader.position).toBe(1)
        reader.readUint16()
        expect(reader.position).toBe(3)
    })

    test('reports remaining bytes', () => {
        const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03]))
        expect(reader.remaining).toBe(3)
        reader.readUint8()
        expect(reader.remaining).toBe(2)
    })

    test('seek moves position', () => {
        const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03]))
        reader.seek(2)
        expect(reader.readUint8()).toBe(0x03)
    })

    test('skip advances position', () => {
        const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03]))
        reader.skip(2)
        expect(reader.readUint8()).toBe(0x03)
    })

    test('throws on read past end', () => {
        const reader = new BinaryReader(createBuffer([0x01]))
        reader.readUint8()
        expect(() => reader.readUint8()).toThrow(RangeError)
    })

    test('throws on seek out of range', () => {
        const reader = new BinaryReader(createBuffer([0x01]))
        expect(() => reader.seek(-1)).toThrow(RangeError)
        expect(() => reader.seek(5)).toThrow(RangeError)
    })

    test('reads bytes', () => {
        const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03]))
        const bytes = reader.readBytes(2)
        expect(bytes[0]).toBe(0x01)
        expect(bytes[1]).toBe(0x02)
    })

    test('reads bool', () => {
        const reader = new BinaryReader(createBuffer([0x00, 0x01]))
        expect(reader.readBool()).toBe(false)
        expect(reader.readBool()).toBe(true)
    })

    test('reports length', () => {
        const reader = new BinaryReader(createBuffer([0x01, 0x02, 0x03]))
        expect(reader.length).toBe(3)
    })
})
