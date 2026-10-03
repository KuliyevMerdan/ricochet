/**
 * Little-endian bytes in and out. The writer grows as it goes and throws on a value its field cannot
 * hold — the encoder runs on our own data, so that is a bug. The reader never throws: a read past
 * the end sets `failed` and returns 0, and the decoder checks once at the end, so a truncated frame
 * is refused without a guard on every field.
 */
export class Writer {
  private buf = new Uint8Array(64);
  private view = new DataView(this.buf.buffer);
  private at = 0;

  private room(n: number): void {
    if (this.at + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.at + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  private check(value: number, lo: number, hi: number, what: string): void {
    if (!Number.isInteger(value) || value < lo || value > hi) {
      throw new RangeError(`${what} ${value} does not fit [${lo}, ${hi}]`);
    }
  }

  u8(value: number): this {
    this.check(value, 0, 0xff, 'u8');
    this.room(1);
    this.view.setUint8(this.at, value);
    this.at += 1;
    return this;
  }

  i8(value: number): this {
    this.check(value, -0x80, 0x7f, 'i8');
    this.room(1);
    this.view.setInt8(this.at, value);
    this.at += 1;
    return this;
  }

  u16(value: number): this {
    this.check(value, 0, 0xffff, 'u16');
    this.room(2);
    this.view.setUint16(this.at, value, true);
    this.at += 2;
    return this;
  }

  u24(value: number): this {
    this.check(value, 0, 0xffffff, 'u24');
    this.room(3);
    this.view.setUint16(this.at, value & 0xffff, true);
    this.view.setUint8(this.at + 2, value >>> 16);
    this.at += 3;
    return this;
  }

  u32(value: number): this {
    this.check(value, 0, 0xffffffff, 'u32');
    this.room(4);
    this.view.setUint32(this.at, value, true);
    this.at += 4;
    return this;
  }

  bytes(value: Uint8Array): this {
    this.room(value.length);
    this.buf.set(value, this.at);
    this.at += value.length;
    return this;
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.at);
  }
}

export class Reader {
  private readonly view: DataView;
  private at = 0;
  failed = false;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private take(n: number): number {
    if (this.failed || this.at + n > this.buf.length) {
      this.failed = true;
      return -1;
    }
    const at = this.at;
    this.at += n;
    return at;
  }

  u8(): number {
    const at = this.take(1);
    return at < 0 ? 0 : this.view.getUint8(at);
  }

  i8(): number {
    const at = this.take(1);
    return at < 0 ? 0 : this.view.getInt8(at);
  }

  u16(): number {
    const at = this.take(2);
    return at < 0 ? 0 : this.view.getUint16(at, true);
  }

  u24(): number {
    const at = this.take(3);
    return at < 0 ? 0 : this.view.getUint16(at, true) | (this.view.getUint8(at + 2) << 16);
  }

  u32(): number {
    const at = this.take(4);
    return at < 0 ? 0 : this.view.getUint32(at, true);
  }

  bytes(n: number): Uint8Array {
    const at = this.take(n);
    return at < 0 ? new Uint8Array(0) : this.buf.slice(at, at + n);
  }

  /** Every byte read, and none missing. */
  get complete(): boolean {
    return !this.failed && this.at === this.buf.length;
  }
}
