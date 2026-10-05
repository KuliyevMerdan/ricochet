import { ARENA_0, RULES } from '@ricochet/protocol';
import type { Arena, ShellAt, View } from '@ricochet/protocol';
import type { TankBody } from '@ricochet/sim';
import { describe, expect, it } from 'vitest';
import { Happenings } from './events.js';
import { OwnShells } from './own.js';
import type { Effect } from './own.js';
import type { DrawnShell } from './picture.js';
import { gunStep } from './prediction.js';

/** An open floor with one wall far to the east, at x 12,000 eighths. */
const OPEN: Arena = {
  id: 9,
  walls: [{ x0: 12_000, y0: 0, x1: 12_400, y1: 16_384 }],
  spawns: [],
  crates: [],
};

const tank = (over: Partial<TankBody> = {}): TankBody => ({
  id: 1,
  x: 4000,
  y: 4000,
  hull: 0,
  turret: 0,
  hp: 3,
  alive: true,
  reload: 0,
  shield: 0,
  respawn: 0,
  score: 0,
  ...over,
});

const view = (tick: number, over: Partial<View> = {}): View => ({
  tick,
  ack: 0,
  self: { reload: 0, shells: 0, respawn: 0, shield: 0 },
  crates: 0,
  tanks: [{ id: 1, x: 4000, y: 4000, hull: 0, turret: 0, hp: 3, shield: false, alive: true }],
  shells: [],
  events: [],
  ...over,
});

/** The server's shell for a shot fired from `tank()` along +x at `tick`, fast-forwarded `lead`. */
const served = (id: number, tick: number, lead: number): ShellAt => ({
  id,
  owner: 1,
  x: 4000 + RULES.muzzle + lead * RULES.shellSpeed,
  y: 4000,
  dir: 0,
  bounced: false,
  age: lead,
  at: tick,
});

const drawn = (own: OwnShells, present: number, nowMs = 0) => {
  const out: DrawnShell[] = [];
  const effects: Effect[] = [];
  own.draw(present, nowMs, out, effects);
  return { out, effects };
};

describe('gunStep — the own gun as sim.step runs it', () => {
  it('counts the timers down, then fires a live, unshielded, loaded tank with room in the air', () => {
    expect(gunStep({ reload: 0, shield: 0 }, true, true, 0)).toEqual({
      gun: { reload: RULES.reload, shield: 0 },
      fires: true,
    });
    expect(gunStep({ reload: 1, shield: 0 }, true, true, 0).fires).toBe(true); // reloaded this tick
    expect(gunStep({ reload: 2, shield: 0 }, true, true, 0).fires).toBe(false);
    expect(gunStep({ reload: 0, shield: 2 }, true, true, 0).fires).toBe(false);
    expect(gunStep({ reload: 0, shield: 0 }, true, true, RULES.maxShells).fires).toBe(false);
    expect(gunStep({ reload: 0, shield: 0 }, true, false, 0).fires).toBe(false);
    expect(gunStep({ reload: 0, shield: 0 }, false, true, 0)).toEqual({
      gun: { reload: 0, shield: 0 },
      fires: false,
    });
  });
});

describe('OwnShells', () => {
  it('fires at once from the muzzle, and flies in the present', () => {
    const own = new OwnShells(OPEN);
    const fx: Effect[] = [];
    own.fire(7, tank(), 100, fx);
    expect(fx).toEqual([{ kind: 'fire', x: 4000, y: 4000, dir: 0, owner: 1 }]);
    expect(drawn(own, 100).out).toEqual([
      { id: -7, owner: 1, x: 4000 + RULES.muzzle, y: 4000, dir: 0 },
    ]);
    expect(drawn(own, 102.5).out[0]?.x).toBe(4000 + RULES.muzzle + 2.5 * RULES.shellSpeed);
  });

  it('adopts the server’s shell named by its shot, under the same id, the step decaying', () => {
    const own = new OwnShells(OPEN);
    own.fire(7, tank(), 100, []);
    // The server fired it at tick 103, two ticks fast-forwarded: a tick behind the prediction.
    const fx: Effect[] = [];
    own.snapshot(
      view(103, {
        ack: 7,
        shells: [served(40, 103, 2)],
        events: [{ type: 'shot', shell: 40, tank: 1, seq: 7 }],
      }),
      1,
      104,
      0,
      fx,
    );
    expect(fx).toEqual([]);
    const at = (present: number, ms: number) => drawn(own, present, ms).out[0];
    expect(at(104, 0)?.id).toBe(-7);
    expect(at(104, 0)?.x).toBeCloseTo(4000 + RULES.muzzle + 4 * RULES.shellSpeed, 6); // where it was
    // At 110 the server's shell has flown its two ticks and seven more; the step has faded.
    const truth = 4000 + RULES.muzzle + (2 + 7) * RULES.shellSpeed;
    expect(Math.abs((at(110, 200)?.x ?? 0) - truth)).toBeLessThan(1);
    expect(own.stats()).toMatchObject({ predicted: 1, adopted: 1, fizzled: 0 });
    expect(own.stats().stepMean).toBeCloseTo(RULES.shellSpeed, 6);
  });

  it('fizzles a shot acknowledged with no shot event — the server refused it', () => {
    const own = new OwnShells(OPEN);
    own.fire(7, tank(), 100, []);
    const fx: Effect[] = [];
    own.snapshot(view(103, { ack: 7 }), 1, 104, 0, fx);
    expect(fx.map((e) => e.kind)).toEqual(['fizzle']);
    expect(drawn(own, 104).out).toEqual([]);
  });

  it('passes through a tank until the server says it hit — then ends with the server’s sparks', () => {
    const own = new OwnShells(OPEN);
    own.fire(7, tank(), 100, []);
    own.snapshot(
      view(101, {
        ack: 7,
        shells: [served(40, 101, 0)],
        events: [{ type: 'shot', shell: 40, tank: 1, seq: 7 }],
      }),
      1,
      101,
      0,
      [],
    );
    // A tank stands 600 eighths ahead: the shell flies through it in the drawing, no effect.
    const passing = drawn(own, 106);
    expect(passing.out).toHaveLength(1);
    expect(passing.effects).toEqual([]);
    const fx: Effect[] = [];
    own.snapshot(
      view(104, {
        ack: 9,
        tanks: [
          { id: 1, x: 4000, y: 4000, hull: 0, turret: 0, hp: 3, shield: false, alive: true },
          { id: 2, x: 4600, y: 4000, hull: 0, turret: 0, hp: 2, shield: false, alive: true },
        ],
        events: [{ type: 'hit', shell: 40, victim: 2, hp: 2 }],
      }),
      1,
      106,
      0,
      fx,
    );
    expect(fx).toEqual([{ kind: 'hit', x: 4600, y: 4000, victim: 2, hp: 2, shell: 40 }]);
    expect(drawn(own, 107).out).toEqual([]);
  });

  it('ends on its second wall by its own flight, and is not taken on again while the view still has it', () => {
    const own = new OwnShells(OPEN);
    own.snapshot(view(100, { shells: [served(40, 100, 0)] }), 1, 100, 0, []);
    // 8,000 − 4,256 eighths to the wall at 160 a tick, there and back: off it once, then 48 ticks.
    const ended: Effect[] = [];
    for (let t = 100; t <= 160; t++) ended.push(...drawn(own, t).effects);
    expect(ended.filter((e) => e.kind === 'end')).toHaveLength(1);
    // The view, a tick or two behind, still carries it: it is not a new shell.
    const fx: Effect[] = [];
    own.snapshot(view(147, { shells: [served(40, 100, 0)] }), 1, 160, 0, fx);
    expect(fx).toEqual([]);
    expect(drawn(own, 160).out).toEqual([]);
  });

  it('counts its shells in the air by their flight, those it has stopped drawing too', () => {
    const own = new OwnShells(ARENA_0);
    own.snapshot(view(100, { shells: [served(40, 100, 3)] }), 1, 100, 0, []);
    const life = RULES.shellLife - 3; // fast-forwarded three ticks: already that old
    expect(own.aliveAt(100 + life - 1)).toBe(1);
    expect(own.aliveAt(100 + life)).toBe(0);
    drawn(own, 100 + life + 2); // the present has passed its end
    expect(own.aliveAt(100 + life - 1)).toBe(1); // the gun asks about the server's ticks
  });
});

describe('Happenings — the server’s events at the drawn time', () => {
  const others = (tick: number, over: Partial<View> = {}) =>
    view(tick, {
      tanks: [
        { id: 1, x: 4000, y: 4000, hull: 0, turret: 0, hp: 3, shield: false, alive: true },
        { id: 2, x: 6000, y: 4000, hull: 0, turret: 0, hp: 3, shield: false, alive: true },
      ],
      ...over,
    });

  it('shows a hit, a kill and a spawn when the drawn time reaches their tick — not before', () => {
    const h = new Happenings(OPEN);
    const shell: ShellAt = {
      id: 9,
      owner: 2,
      x: 5000,
      y: 4000,
      dir: 512,
      bounced: false,
      age: 3,
      at: 10,
    };
    const views = [
      others(10, { shells: [shell] }),
      others(11, {
        events: [
          { type: 'hit', shell: 9, victim: 1, hp: 0 },
          { type: 'kill', killer: 2, victim: 1 },
        ],
      }),
      others(12, { events: [{ type: 'spawn', tank: 2 }] }),
    ];
    const fx: Effect[] = [];
    h.update(views, 10, 1, null, fx); // starts here: nothing before
    h.update(views, 10.9, 1, null, fx);
    expect(fx).toEqual([]);
    h.update(views, 11.2, 1, { x: 4100, y: 4000 }, fx);
    expect(fx).toEqual([
      { kind: 'hit', x: 4100, y: 4000, victim: 1, hp: 0, shell: 9 }, // on the own tank, as drawn
      { kind: 'kill', x: 4100, y: 4000, killer: 2, victim: 1 },
    ]);
    h.update(views, 12, 1, null, fx);
    expect(fx.at(-1)).toEqual({ kind: 'spawn', x: 6000, y: 4000, tank: 2 });
  });

  it('leaves the own shells’ hits to OwnShells, and says nothing of a shell that left the view', () => {
    const h = new Happenings(OPEN);
    const mine: ShellAt = {
      id: 5,
      owner: 1,
      x: 5000,
      y: 4000,
      dir: 0,
      bounced: false,
      age: 0,
      at: 10,
    };
    const theirs: ShellAt = {
      id: 6,
      owner: 2,
      x: 5000,
      y: 4400,
      dir: 768,
      bounced: false,
      age: 0,
      at: 10,
    };
    const views = [
      others(10, { shells: [mine, theirs] }),
      others(11, { events: [{ type: 'hit', shell: 5, victim: 2, hp: 2 }] }),
    ];
    const fx: Effect[] = [];
    h.update(views, 10, 1, null, fx);
    h.update(views, 11, 1, null, fx);
    expect(fx).toEqual([]);
  });

  it('ends an other’s shell where its flight met the second wall', () => {
    const h = new Happenings(OPEN);
    // 40 eighths from the wall at 12,000 and bounced already: its next move meets it.
    const s: ShellAt = {
      id: 6,
      owner: 2,
      x: 12_000 - RULES.shellRadius - 40,
      y: 4000,
      dir: 0,
      bounced: true,
      age: 20,
      at: 10,
    };
    const views = [others(10, { shells: [s] }), others(11)];
    const fx: Effect[] = [];
    h.update(views, 10, 1, null, fx);
    h.update(views, 11, 1, null, fx);
    expect(fx).toEqual([{ kind: 'end', x: 12_000 - RULES.shellRadius, y: 4000, owner: 2 }]);
  });
});
