/**
 * UTF-8 by hand. `TextEncoder` is not in the ES library this package compiles against — it may name
 * neither the DOM nor Node — and a name is the only string on the wire. The decoder is strict:
 * overlong forms, surrogates and code points past U+10FFFF are refused, so one string has one
 * encoding and the server's checks cannot be dodged by spelling a character two ways.
 */
export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return Uint8Array.from(out);
}

export function decodeUtf8(bytes: Uint8Array): string | null {
  let text = '';
  let i = 0;
  const cont = (k: number): number | null => {
    const b = bytes[i + k];
    return b !== undefined && (b & 0xc0) === 0x80 ? b & 0x3f : null;
  };
  while (i < bytes.length) {
    const b0 = bytes[i] ?? 0;
    let cp: number;
    let len: number;
    let min: number;
    if (b0 < 0x80) {
      cp = b0;
      len = 1;
      min = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      const b1 = cont(1);
      if (b1 === null) return null;
      cp = ((b0 & 0x1f) << 6) | b1;
      len = 2;
      min = 0x80;
    } else if ((b0 & 0xf0) === 0xe0) {
      const b1 = cont(1);
      const b2 = cont(2);
      if (b1 === null || b2 === null) return null;
      cp = ((b0 & 0x0f) << 12) | (b1 << 6) | b2;
      len = 3;
      min = 0x800;
    } else if ((b0 & 0xf8) === 0xf0) {
      const b1 = cont(1);
      const b2 = cont(2);
      const b3 = cont(3);
      if (b1 === null || b2 === null || b3 === null) return null;
      cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
      len = 4;
      min = 0x10000;
    } else {
      return null;
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    text += String.fromCodePoint(cp);
    i += len;
  }
  return text;
}
