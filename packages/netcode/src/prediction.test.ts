import { RULES } from '@ricochet/protocol';
import type { Arena, Input } from '@ricochet/protocol';
import { stepTank } from '@ricochet/sim';
import type { TankBody } from '@ricochet/sim';
import { describe, expect, it } from 'vitest';
import { Prediction } from './prediction.js';

/** An open floor: nothing to stop a tank but other tanks. */
const OPEN: Arena = { id: 9, walls: [], spawns: [], crates: [] };

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

const input = (seq: number, move: number | null = 0, aim = 0): Input => ({
  type: 'input',
  seq,
  aim,
  move,
  fire: false,
});

describe('Prediction', () => {
  it('applies each input at once, and on a snapshot replays only what it did not acknowledge', () => {
    const p = new Prediction(OPEN);
    p.reconcile(tank(), 0, 10, 0);
    const inputs = [input(1, 0), input(2, 256), input(3, 512, 100)];
    for (const i of inputs) p.push(i);
    let t = tank();
    for (const i of inputs) t = stepTank(t, i, OPEN);
    expect(p.tank).toEqual(t);
    expect(p.unacked).toBe(3);

    // The server applied 1 and 2 from somewhere a little different (another tank stopped it).
    const server = {
      ...stepTank(stepTank(tank(), inputs[0] ?? input(0), OPEN), input(2, 256), OPEN),
      x: 4040,
    };
    p.reconcile(server, 2, 12, 0);
    expect(p.unacked).toBe(1);
    // Only input 3 is replayed — an acknowledged input is never applied twice.
    expect(p.tank).toEqual(stepTank(server, input(3, 512, 100), OPEN));
  });

  it('is judged by what it said the server would hold once it had applied the ack', () => {
    const p = new Prediction(OPEN);
    p.reconcile(tank(), 0, 10, 0);
    p.push(input(1));
    p.push(input(2));
    const expected = stepTank(tank(), input(1), OPEN);
    const r = p.reconcile(expected, 1, 11, 0);
    expect(r.predicted).toEqual(expected);
    expect(r.moved).toBe(0);
    // A tick with no input applied: the tank stood (D15), so the prediction is the last base.
    const stood = p.reconcile(expected, 1, 12, 33);
    expect(stood.predicted).toEqual(expected);
    // Nothing predicted for an input it never sent, nor before its first snapshot.
    expect(new Prediction(OPEN).reconcile(tank(), 0, 1, 0).predicted).toBeNull();
  });

  it('smooths a correction away over ~100 ms rather than jumping', () => {
    const p = new Prediction(OPEN);
    p.reconcile(tank(), 0, 10, 0);
    p.push(input(1, 0));
    // The server's tank did not move — blocked by something the client did not see.
    const r = p.reconcile(tank(), 1, 11, 1000);
    expect(r.snapped).toBe(false);
    expect(r.moved).toBe(RULES.tankSpeed);
    // Drawn where it was a moment ago: the offset is the whole correction, and fades.
    expect(p.offset(1000).x).toBeCloseTo(RULES.tankSpeed, 9);
    expect(Math.abs(p.offset(1100).x)).toBeLessThan(0.05 * RULES.tankSpeed);
    expect(Math.abs(p.offset(1300).x)).toBeLessThan(0.01);
  });

  it('draws a respawn — far, or a change of life — at once', () => {
    const p = new Prediction(OPEN);
    p.reconcile(tank({ alive: false, hp: 0 }), 0, 10, 0);
    p.push(input(1));
    const back = tank({ x: 12_000, y: 12_000 });
    const r = p.reconcile(back, 1, 11, 500);
    expect(r.snapped).toBe(true);
    expect(p.offset(500)).toEqual({ x: 0, y: 0 });
  });

  it('stops at another tank where it will be — a step on, for one that drives first', () => {
    // Facing +x, driving +x: another tank ahead, coming this way 20 eighths a tick, starting just
    // far enough off that a tank that has not moved yet is touched and not entered.
    const reach = 2 * RULES.tankRadius;
    const other = { x: 4000 + RULES.tankSpeed + reach, y: 4000, vx: -20, vy: 0 };
    const after = (ahead: boolean) => {
      const p = new Prediction(OPEN);
      p.reconcile(tank(), 0, 10, 0, [{ ...other, ahead }]);
      p.push(input(1, 0));
      return p.tank?.x;
    };
    expect(after(false)).toBe(4000 + RULES.tankSpeed);
    expect(after(true)).toBe(4000 + RULES.tankSpeed - 20);
  });
});
