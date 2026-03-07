/**
 * Sequential binary reader wrapping DataView for parsing .rm files
 */
export class BinaryReader {
    private readonly view: DataView
    private offset: number
    private readonly littleEndian: boolean

    constructor(buffer: ArrayBuffer, littleEndian = true) {
        this.view = new DataView(buffer)
        this.offset = 0
        this.littleEndian = littleEndian
    }

    get position(): number {
        return this.offset
    }

    get remaining(): number {
        return this.view.byteLength - this.offset
    }

    get length(): number {
        return this.view.byteLength
    }

    seek(position: number): void {
        if (position < 0 || position > this.view.byteLength) {
            throw new RangeError(
                `Seek position ${position} out of range [0, ${this.view.byteLength}]`
            )
        }
        this.offset = position
    }

    skip(bytes: number): void {
        this.seek(this.offset + bytes)
    }

    readUint8(): number {
        this.ensureRemaining(1)
        const value = this.view.getUint8(this.offset)
        this.offset += 1
        return value
    }

    readUint16(): number {
        this.ensureRemaining(2)
        const value = this.view.getUint16(this.offset, this.littleEndian)
        this.offset += 2
        return value
    }

    readUint32(): number {
        this.ensureRemaining(4)
        const value = this.view.getUint32(this.offset, this.littleEndian)
        this.offset += 4
        return value
    }

    readInt32(): number {
        this.ensureRemaining(4)
        const value = this.view.getInt32(this.offset, this.littleEndian)
        this.offset += 4
        return value
    }

    readFloat32(): number {
        this.ensureRemaining(4)
        const value = this.view.getFloat32(this.offset, this.littleEndian)
        this.offset += 4
        return value
    }

    readFloat64(): number {
        this.ensureRemaining(8)
        const value = this.view.getFloat64(this.offset, this.littleEndian)
        this.offset += 8
        return value
    }

    readBytes(length: number): Uint8Array {
        this.ensureRemaining(length)
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length)
        this.offset += length
        return bytes
    }

    readString(length: number): string {
        const bytes = this.readBytes(length)
        return new TextDecoder('ascii').decode(bytes)
    }

    readBool(): boolean {
        return this.readUint8() !== 0
    }

    readVarUint(): number {
        let result = 0
        let shift = 0
        let byte: number
        do {
            byte = this.readUint8()
            result |= (byte & 0x7f) << shift
            shift += 7
        } while (byte & 0x80)
        return result
    }

    private ensureRemaining(bytes: number): void {
        if (this.offset + bytes > this.view.byteLength) {
            throw new RangeError(
                `Attempted to read ${bytes} bytes at offset ${this.offset}, but only ${this.remaining} bytes remain`
            )
        }
    }
}
