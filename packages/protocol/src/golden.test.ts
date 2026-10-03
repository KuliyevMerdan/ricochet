import { describe, expect, it } from 'vitest';
import { CLIENT_GOLDEN, SERVER_GOLDEN, hex } from './__fixtures__/golden.js';
import { decodeClient, decodeServer, encodeClient, encodeServer } from './index.js';

describe.each(CLIENT_GOLDEN)('client golden: %s', (_name, msg, bytes) => {
  it('encodes to the bytes written by hand', () => {
    expect(encodeClient(msg)).toEqual(hex(bytes));
  });

  it('decodes from them', () => {
    expect(decodeClient(hex(bytes))).toEqual({ ok: true, value: msg });
  });

  it('refuses every truncation, and a trailing byte', () => {
    const full = hex(bytes);
    for (let n = 0; n < full.length; n++) {
      expect(decodeClient(full.slice(0, n))).toEqual({ ok: false, reason: 'truncated' });
    }
    expect(decodeClient(Uint8Array.from([...full, 0]))).toEqual({
      ok: false,
      reason: 'trailing bytes',
    });
  });

  it('is never taken for a server message', () => {
    expect(decodeServer(hex(bytes)).ok).toBe(false);
  });
});

describe.each(SERVER_GOLDEN)('server golden: %s', (_name, msg, bytes) => {
  it('encodes to the bytes written by hand', () => {
    expect(encodeServer(msg)).toEqual(hex(bytes));
  });

  it('decodes from them', () => {
    expect(decodeServer(hex(bytes))).toEqual({ ok: true, value: msg });
  });

  it('refuses every truncation, and a trailing byte', () => {
    const full = hex(bytes);
    for (let n = 0; n < full.length; n++) {
      expect(decodeServer(full.slice(0, n))).toEqual({ ok: false, reason: 'truncated' });
    }
    expect(decodeServer(Uint8Array.from([...full, 0]))).toEqual({
      ok: false,
      reason: 'trailing bytes',
    });
  });

  it('is never taken for a client message', () => {
    expect(decodeClient(hex(bytes)).ok).toBe(false);
  });
});
