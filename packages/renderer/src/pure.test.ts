import { describe, expect, it } from 'vitest';
import { ShellWatch } from './effects.js';
import type { ShellEvents } from './effects.js';
import { TANKS, tint } from './palette.js';
import type { ShellPicture, TankPicture } from './picture.js';
import { CameraRig, LEAD, VIEW_HALF, zoomFor } from './view.js';

const tank = (id: number, x: number, y: number, turret = 0): TankPicture => ({
  id,
  x,
  y,
  hull: 0,
  turret,
  alive: true,
  shield: false,
});
const shell = (id: number, owner: number, x: number, y: number, dir = 0): ShellPicture => ({
  id,
  owner,
  x,
  y,
  dir,
});

function recorder() {
  const log: string[] = [];
  const on: ShellEvents = {
    fired: (_x, _y, _d, owner) => log.push(`fired ${owner}`),
    bounced: (x, y) => log.push(`bounced ${x},${y}`),
  };
  return { log, on };
}

describe('the camera', () => {
  it('shows no more than 640 units from the centre on either axis', () => {
    for (const [w, h] of [
      [1920, 1080],
      [750, 1624],
      [1280, 1280],
    ] as const) {
      const z = zoomFor(w, h);
      expect(Math.max(w, h) / 2 / z).toBeCloseTo(VIEW_HALF, 9);
      expect(Math.min(w, h) / 2 / z).toBeLessThanOrEqual(VIEW_HALF);
    }
  });

  it('leads toward the aim by 80 units, easing in at any frame rate alike', () => {
    // 120 ms at 50 frames a second and at 125: six frames, and fifteen.
    const slow = new CameraRig();
    const fast = new CameraRig();
    let a = { x: 0, y: 0 };
    let b = { x: 0, y: 0 };
    for (let i = 0; i < 6; i++) a = slow.update({ x: 800, y: 800 }, 0, 20);
    for (let i = 0; i < 15; i++) b = fast.update({ x: 800, y: 800 }, 0, 8);
    expect(a.x).toBeCloseTo(b.x, 9); // the same ease, whatever the display
    expect(a.x - 100).toBeGreaterThan(0.55 * LEAD); // ~63 % of the way after one time constant
    expect(a.x - 100).toBeLessThan(0.7 * LEAD);
    for (let i = 0; i < 100; i++) a = slow.update({ x: 800, y: 800 }, 256, 1000 / 60);
    expect(a.x).toBeCloseTo(100, 3); // aiming down: no lead along x …
    expect(a.y).toBeCloseTo(100 + LEAD, 3); // … all of it along y
  });
});

describe('the palette', () => {
  it('gives a room of twelve twelve different colours', () => {
    expect(new Set(Array.from({ length: 12 }, (_, i) => tint(i + 1))).size).toBe(12);
    expect(TANKS).toHaveLength(12);
  });
});

describe('ShellWatch', () => {
  it('flashes a muzzle for a shell fired in view, not for one that flew in from afar', () => {
    const w = new ShellWatch();
    const { log, on } = recorder();
    const a = tank(1, 1000, 1000);
    const b = tank(2, 9000, 9000);
    w.update([], [a, b], null, on);
    w.update([shell(5, 1, 1300, 1000), shell(6, 2, 2000, 2000)], [a, b], null, on);
    expect(log).toEqual(['fired 1']);
  });

  it('sparks where a shell turns off a wall, and says nothing when one vanishes', () => {
    const w = new ShellWatch();
    const { log, on } = recorder();
    const t = tank(3, 5000, 5000);
    w.update([shell(5, 1, 1000, 1000, 0), shell(6, 1, 4800, 5000, 0)], [t], null, on);
    w.update([shell(5, 1, 1100, 1000, 512), shell(6, 1, 4900, 5000, 0)], [t], null, on);
    // Gone beside a tank: a hit is the server's word (`netcode`'s effects), never a guess here.
    w.update([], [t], null, on);
    expect(log).toEqual(['bounced 1100,1000']);
  });

  it('leaves the own shots to netcode: no flash from a shell of the own tank', () => {
    const w = new ShellWatch();
    const { log, on } = recorder();
    const me = tank(1, 1000, 1000);
    w.update([], [], me, on);
    w.update([shell(-7, 1, 1300, 1000)], [], me, on);
    expect(log).toEqual([]);
  });

  it('allocates no record in steady play: a gone shell’s is reused', () => {
    const w = new ShellWatch();
    const { on } = recorder();
    w.update([shell(1, 1, 0, 0)], [], null, on);
    w.update([], [], null, on);
    const spare = (w as unknown as { spare: unknown[] }).spare;
    expect(spare).toHaveLength(1);
    w.update([shell(2, 1, 0, 0)], [], null, on);
    expect(spare).toHaveLength(0);
  });
});
