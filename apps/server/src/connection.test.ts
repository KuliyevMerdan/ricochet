import { encodeClient, decodeServer } from '@ricochet/protocol';
import type { ErrorCode, ServerMessage } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { Connection } from './connection.js';
import type { LabControl, Socket } from './connection.js';
import { Lobby } from './lobby.js';

function rig(now = { t: 0 }, link: LabControl | null = null) {
  const got: ServerMessage[] = [];
  let refused: ErrorCode | null = null;
  const socket: Socket = {
    send: (f) => {
      const d = decodeServer(f);
      if (d.ok) got.push(d.value);
    },
    close: () => {},
    refuse: (code) => (refused = code),
    rttMs: () => null,
    backlog: () => 0,
    link,
  };
  const lobby = new Lobby({
    maxRooms: 5,
    idleTicks: 60,
    token: () => '00'.repeat(16),
    seed: () => 1,
    tick: () => 0,
  });
  const c = new Connection(socket, lobby, {
    now: () => now.t,
    phase: () => ({ tick: 40, offsetMs: 12.5 }),
  });
  return { c, got, refused: () => refused, lobby };
}

const hello = (name = 'Ann', version = 1) =>
  encodeClient({ type: 'hello', version, token: null, name });

describe('Connection', () => {
  it('welcomes a hello with an id, a token and the tick', () => {
    const r = rig();
    r.c.receive(hello());
    expect(r.got[0]).toMatchObject({
      type: 'welcome',
      version: 1,
      you: 1,
      resumed: false,
      arena: 0,
    });
    expect(r.got[1]).toEqual({
      type: 'roster',
      entries: [{ id: 1, bot: false, score: 0, name: 'Ann' }],
    });
  });

  it.each([
    ['anything before hello', encodeClient({ type: 'ping', id: 1 }), 'MALFORMED'],
    ['a text frame first', null, 'MALFORMED'],
    ['another version', hello('Ann', 2), 'VERSION'],
    ['a name the rules refuse', Uint8Array.from([1, 1, 0, 3, 0x41, 7, 0x41]), 'NAME'],
  ] as const)('refuses %s with %s', (_name, frame, code) => {
    const r = rig();
    r.c.receive(frame);
    expect(r.refused()).toBe(code);
  });

  it('closes a socket on its third malformed frame, not before', () => {
    const r = rig();
    r.c.receive(hello());
    r.c.receive(Uint8Array.from([9]));
    r.c.receive(Uint8Array.from([9]));
    expect(r.refused()).toBeNull();
    r.c.receive(Uint8Array.from([9]));
    expect(r.refused()).toBe('MALFORMED');
  });

  it('says RATE past twice the tick rate of inputs in a second', () => {
    const now = { t: 0 };
    const r = rig(now);
    r.c.receive(hello());
    for (let seq = 1; seq <= 60; seq++)
      r.c.receive(encodeClient({ type: 'input', seq, aim: 0, move: null, fire: false }));
    expect(r.refused()).toBeNull();
    r.c.receive(encodeClient({ type: 'input', seq: 61, aim: 0, move: null, fire: false }));
    expect(r.refused()).toBe('RATE');
  });

  it('answers a ping with the room’s tick and the offset into it', () => {
    const r = rig();
    r.c.receive(hello());
    r.c.receive(encodeClient({ type: 'ping', id: 7 }));
    expect(r.got.at(-1)).toEqual({ type: 'pong', id: 7, tick: 40, offsetUs: 12_500 });
  });

  it('hands lab and stall to its own socket’s link, and to nobody’s on a server without one', () => {
    const calls: unknown[] = [];
    const link: LabControl = {
      set: (f) => calls.push(['set', f]),
      stall: (ms) => calls.push(['stall', ms]),
    };
    const r = rig({ t: 0 }, link);
    r.c.receive(hello());
    r.c.receive(encodeClient({ type: 'lab', latencyMs: 300, jitterMs: 40 }));
    r.c.receive(encodeClient({ type: 'stall', ms: 2000 }));
    expect(calls).toEqual([
      ['set', { latencyMs: 300, jitterMs: 40 }],
      ['stall', 2000],
    ]);

    const off = rig();
    off.c.receive(hello());
    off.c.receive(encodeClient({ type: 'lab', latencyMs: 300, jitterMs: 40 }));
    off.c.receive(encodeClient({ type: 'stall', ms: 2000 }));
    expect(off.refused()).toBeNull();
  });

  it('refuses a lab frame before hello, as anything else', () => {
    const r = rig();
    r.c.receive(encodeClient({ type: 'lab', latencyMs: 0, jitterMs: 0 }));
    expect(r.refused()).toBe('MALFORMED');
  });
});
