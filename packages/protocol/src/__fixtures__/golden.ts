import type { ClientMessage, ServerMessage } from '../messages.js';

/**
 * Every message, written by hand, beside its bytes — also written by hand, field by field from
 * docs/protocol.md § 4, never printed by the encoder. The codec is held to them in both directions.
 * Spaces in the hex separate fields; they mean nothing.
 */

const token = (byte: (i: number) => number) => Uint8Array.from({ length: 16 }, (_, i) => byte(i));

export const CLIENT_GOLDEN: ReadonlyArray<readonly [string, ClientMessage, string]> = [
  [
    'hello, new player',
    { type: 'hello', version: 1, token: null, name: 'Ann' },
    '01 01 00 03 416e6e',
  ],
  [
    'hello, resuming, a Cyrillic name',
    { type: 'hello', version: 1, token: token((i) => i), name: 'Мира' },
    '01 01 01 000102030405060708090a0b0c0d0e0f 08 d09cd0b8d180d0b0',
  ],
  [
    'input, standing, aim east, not firing',
    { type: 'input', seq: 1, aim: 0, move: null, fire: false },
    '02 01000000 00000000',
  ],
  [
    'input, moving down, aim just short of east, firing',
    // aim 0x3ff | move 256 << 10 | moving 1 << 20 | fire 1 << 21 = 0x3403ff
    { type: 'input', seq: 258, aim: 1023, move: 256, fire: true },
    '02 02010000 ff033400',
  ],
  ['ping', { type: 'ping', id: 0x1234 }, '03 3412'],
];

export const SERVER_GOLDEN: ReadonlyArray<readonly [string, ServerMessage, string]> = [
  [
    'welcome, resumed',
    {
      type: 'welcome',
      version: 1,
      you: 7,
      token: token(() => 0xff),
      tick: 0x01020304,
      resumed: true,
      arena: 0,
    },
    '81 01 0700 ffffffffffffffffffffffffffffffff 04030201 01 00',
  ],
  [
    'snapshot',
    {
      type: 'snapshot',
      tick: 100,
      ack: 5,
      self: { reload: 3, shells: 1, respawn: 0, shield: 0 },
      crates: 0b0101,
      tanks: {
        removed: [],
        updated: [
          {
            id: 1,
            pos: { kind: 'abs', x: 8192, y: 4096 },
            // hull 0x100 | turret 768 << 10 | hp 3 << 20 | alive 1 << 23 = 0xbc0100
            state: { hull: 256, turret: 768, hp: 3, shield: false, alive: true },
          },
          { id: 2, pos: { kind: 'rel', dx: -3, dy: 59 }, state: null },
        ],
      },
      shells: {
        removed: [9],
        // dir 768 | bounced 1 << 10 = 0x0700
        added: [{ id: 10, owner: 1, x: 8448, y: 4096, dir: 768, bounced: true, age: 2 }],
      },
      events: [
        { type: 'shot', shell: 10, tank: 1, seq: 5 },
        { type: 'kill', killer: 1, victim: 2 },
      ],
    },
    [
      '82 64000000 05000000 03 01 00 00 05',
      '00',
      '02 0100 05 0020 0010 0001bc  0200 02 fd 3b',
      '01 0900',
      '01 0a00 0100 0021 0010 0007 02',
      '02 01 0a00 0100 05000000  03 0100 0200',
    ].join(' '),
  ],
  [
    'roster',
    {
      type: 'roster',
      entries: [
        { id: 1, bot: false, score: 12, name: 'Ann' },
        { id: 2, bot: true, score: 0, name: 'Bot 2' },
      ],
    },
    '83 02 0100 00 0c00 03 416e6e  0200 01 0000 05 426f742032',
  ],
  ['pong', { type: 'pong', id: 1, tick: 30, offsetUs: 33332 }, '84 0100 1e000000 3482'],
  ['error', { type: 'error', code: 'NAME' }, '85 03'],
];

export function hex(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  return Uint8Array.from({ length: clean.length / 2 }, (_, i) =>
    parseInt(clean.slice(i * 2, i * 2 + 2), 16),
  );
}
