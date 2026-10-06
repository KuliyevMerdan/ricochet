import { describe, expect, it } from 'vitest';
import {
  LAB_LIMITS,
  RULES,
  apply,
  decodeClient,
  decodeServer,
  decodeUtf8,
  diff,
  encodeClient,
  encodeServer,
  encodeUtf8,
} from './index.js';
import type { ClientMessage, GameEvent, ServerMessage, ShellAt, Tank, View } from './index.js';

/** A small seeded generator — the test's own; the package has no randomness. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(42);
const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
const bool = () => random() < 0.5;
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
const NAMES = ['Ann', 'Мира', '李小龙', 'Bot 7', 'x', 'sixteen chars ok', '🙂🙂', 'O’Neil'];
const token = () => Uint8Array.from({ length: 16 }, () => int(0, 255));
const coord = () => int(0, RULES.arena - 1);
const dir = () => int(0, 1023);

function event(): GameEvent {
  switch (int(0, 4)) {
    case 0:
      return { type: 'shot', shell: int(0, 0xffff), tank: int(0, 0xffff), seq: int(1, 0xffffffff) };
    case 1:
      return { type: 'hit', shell: int(0, 0xffff), victim: int(0, 0xffff), hp: int(0, 3) };
    case 2:
      return { type: 'kill', killer: int(0, 0xffff), victim: int(0, 0xffff) };
    case 3:
      return { type: 'crate', spot: int(0, 3), tank: int(0, 0xffff) };
    default:
      return { type: 'spawn', tank: int(0, 0xffff) };
  }
}

function clientMessage(): ClientMessage {
  switch (int(0, 4)) {
    case 0:
      return {
        type: 'hello',
        version: int(0, 255),
        token: bool() ? token() : null,
        name: pick(NAMES),
      };
    case 1:
      return {
        type: 'input',
        seq: int(1, 0xffffffff),
        aim: dir(),
        move: bool() ? dir() : null,
        fire: bool(),
      };
    case 2:
      return {
        type: 'lab',
        latencyMs: int(0, LAB_LIMITS.latencyMs),
        jitterMs: int(0, LAB_LIMITS.jitterMs),
      };
    case 3:
      return { type: 'stall', ms: int(1, LAB_LIMITS.stallMs) };
    default:
      return { type: 'ping', id: int(0, 0xffff) };
  }
}

function tank(id: number): Tank {
  return {
    id,
    x: coord(),
    y: coord(),
    hull: dir(),
    turret: dir(),
    hp: int(0, 3),
    shield: bool(),
    alive: bool(),
  };
}

function shell(id: number, at: number): ShellAt {
  return {
    id,
    owner: int(0, 0xffff),
    x: coord(),
    y: coord(),
    dir: dir(),
    bounced: bool(),
    age: int(0, RULES.shellLife),
    at,
  };
}

function view(tick: number, tanks: Tank[], shells: ShellAt[]): View {
  return {
    tick,
    ack: int(0, 0xffffffff),
    self: {
      reload: int(0, RULES.reload),
      shells: int(0, RULES.maxShells),
      respawn: int(0, RULES.respawn),
      shield: int(0, RULES.shield),
    },
    crates: int(0, 15),
    tanks: [...tanks].sort((a, b) => a.id - b.id),
    shells: [...shells].sort((a, b) => a.id - b.id),
    events: Array.from({ length: int(0, 4) }, event),
  };
}

function serverMessage(): ServerMessage {
  switch (int(0, 4)) {
    case 0:
      return {
        type: 'welcome',
        version: int(0, 255),
        you: int(0, 0xffff),
        token: token(),
        tick: int(0, 0xffffffff),
        resumed: bool(),
        arena: int(0, 255),
      };
    case 1: {
      const base = bool() ? view(1, [tank(1), tank(2)], [shell(1, 1)]) : null;
      return diff(base, view(2, [tank(2), tank(3)], [shell(2, 2)]));
    }
    case 2:
      return {
        type: 'roster',
        entries: Array.from({ length: int(0, 12) }, (_, i) => ({
          id: i,
          bot: bool(),
          score: int(0, 0xffff),
          name: pick(NAMES),
        })),
      };
    case 3:
      return {
        type: 'pong',
        id: int(0, 0xffff),
        tick: int(0, 0xffffffff),
        offsetUs: int(0, 33333),
      };
    default:
      return {
        type: 'error',
        code: pick(['VERSION', 'MALFORMED', 'NAME', 'RATE', 'FULL'] as const),
      };
  }
}

describe('round trips', () => {
  it('decode(encode(m)) = m for 100,000 random messages each way', () => {
    let failures = 0;
    for (let i = 0; i < 100_000; i++) {
      const c = clientMessage();
      const s = serverMessage();
      const backC = decodeClient(encodeClient(c));
      const backS = decodeServer(encodeServer(s));
      if (!backC.ok || JSON.stringify(backC.value) !== JSON.stringify(c)) failures++;
      if (!backS.ok || JSON.stringify(backS.value) !== JSON.stringify(s)) failures++;
    }
    expect(failures).toBe(0);
  }, 60_000);

  it('UTF-8 round-trips every code point outside the surrogates', () => {
    let failures = 0;
    for (let cp = 0; cp <= 0x10ffff; cp += cp < 0x800 ? 1 : 37) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const s = String.fromCodePoint(cp);
      if (decodeUtf8(encodeUtf8(s)) !== s) failures++;
    }
    expect(failures).toBe(0);
  });
});

/**
 * A world that moves: tanks drive, turn, die and leave; shells are fired and land. The views a
 * client is sent, each diffed against the last, applied on the other side through the real bytes.
 */
describe('snapshots as deltas', () => {
  it('apply(base, decode(encode(diff(base, next)))) is next, over 20,000 ticks of a moving world', () => {
    let tanks = new Map<number, Tank>();
    let shells = new Map<number, ShellAt>();
    let nextShell = 1;
    let sent: View | null = null;
    let held: View | null = null;
    let failures = 0;
    let rel = 0;
    let bytes = 0;

    for (let tick = 1; tick <= 20_000; tick++) {
      tanks = new Map(
        [...tanks.values()]
          .filter(() => random() > 0.002)
          .map((t) => {
            if (random() < 0.01) return [t.id, tank(t.id)]; // a respawn: anywhere
            const nx = Math.min(RULES.arena - 1, Math.max(0, t.x + int(-59, 59)));
            const ny = Math.min(RULES.arena - 1, Math.max(0, t.y + int(-59, 59)));
            return [t.id, { ...t, x: nx, y: ny, turret: random() < 0.5 ? dir() : t.turret }];
          }),
      );
      while (tanks.size < 12 && random() < 0.1) {
        const id = int(1, 40);
        if (!tanks.has(id)) tanks.set(id, tank(id));
      }
      shells = new Map([...shells].filter(() => random() > 0.05));
      if (random() < 0.5 && shells.size < 36) {
        shells.set(nextShell, shell(nextShell, tick));
        nextShell = (nextShell % 0xffff) + 1;
      }
      // The server's view of a shell already in flight has moved on; the delta must not resend it.
      const next = view(
        tick,
        [...tanks.values()],
        [...shells.values()].map((s) =>
          s.at === tick ? s : { ...s, x: coord(), age: int(0, 48) },
        ),
      );

      const frame = encodeServer(diff(sent, next));
      bytes += frame.length;
      const decoded = decodeServer(frame);
      if (!decoded.ok || decoded.value.type !== 'snapshot') {
        failures++;
        continue;
      }
      rel += decoded.value.tanks.updated.filter((u) => u.pos?.kind === 'rel').length;
      const applied = apply(held, decoded.value);
      // What the client must hold: every tank as the server has it; every shell as it was when it
      // entered the view — the starting condition the client flies on from.
      const firstSeen = new Map((held?.shells ?? []).map((s) => [s.id, s]));
      const expected: View = {
        ...next,
        shells: next.shells.map((s) => firstSeen.get(s.id) ?? s),
      };
      if (!applied.ok || JSON.stringify(applied.value) !== JSON.stringify(expected)) failures++;
      sent = next;
      held = applied.ok ? applied.value : held;
    }

    expect(failures).toBe(0);
    expect(rel).toBeGreaterThan(100_000); // moving tanks went as small steps
    expect(bytes / 20_000).toBeLessThan(200); // ≈ bytes a tick for ~12 tanks and ~10 shells
  }, 60_000);

  const base: View = {
    tick: 1,
    ack: 0,
    self: { reload: 0, shells: 0, respawn: 0, shield: 0 },
    crates: 0,
    tanks: [{ id: 1, x: 100, y: 100, hull: 0, turret: 0, hp: 3, shield: false, alive: true }],
    shells: [{ id: 5, owner: 1, x: 10, y: 10, dir: 0, bounced: false, age: 0, at: 1 }],
    events: [],
  };
  const empty = { ...diff(base, base), tick: 2 };

  it.each([
    ['removes a tank the base does not hold', { ...empty, tanks: { removed: [9], updated: [] } }],
    [
      'updates a tank twice',
      {
        ...empty,
        tanks: {
          removed: [],
          updated: [
            { id: 1, pos: null, state: base.tanks[0] ?? null },
            { id: 1, pos: { kind: 'rel' as const, dx: 1, dy: 0 }, state: null },
          ],
        },
      },
    ],
    [
      'gives a new tank only a step',
      {
        ...empty,
        tanks: {
          removed: [],
          updated: [{ id: 2, pos: { kind: 'rel' as const, dx: 1, dy: 0 }, state: null }],
        },
      },
    ],
    [
      'moves a tank off the arena',
      {
        ...empty,
        tanks: {
          removed: [],
          updated: [{ id: 1, pos: { kind: 'rel' as const, dx: -127, dy: 0 }, state: null }],
        },
      },
    ],
    ['removes a shell the base does not hold', { ...empty, shells: { removed: [6], added: [] } }],
    [
      'adds a shell already in flight',
      {
        ...empty,
        shells: {
          removed: [],
          added: [{ id: 5, owner: 1, x: 0, y: 0, dir: 0, bounced: false, age: 0 }],
        },
      },
    ],
  ])('apply refuses a delta that %s', (_name, snap) => {
    expect(apply(base, snap).ok).toBe(false);
  });

  it('applies a first snapshot against nothing', () => {
    const first = apply(null, diff(null, base));
    expect(first).toEqual({ ok: true, value: base });
  });
});
