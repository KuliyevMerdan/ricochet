import type { RosterEntry } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { stickOf } from './controls.js';
import { stress } from './stress.js';
import { rank } from './ui.js';

describe('the keyboard stick', () => {
  it('drives the eight ways, and stands when nothing — or two opposite keys — is held', () => {
    expect(stickOf(new Set())).toBeNull();
    expect(stickOf(new Set(['KeyD']))).toBe(0);
    expect(stickOf(new Set(['KeyS']))).toBe(256);
    expect(stickOf(new Set(['ArrowLeft']))).toBe(512);
    expect(stickOf(new Set(['KeyW']))).toBe(768);
    expect(stickOf(new Set(['KeyD', 'KeyS']))).toBe(128);
    expect(stickOf(new Set(['KeyA', 'KeyD']))).toBeNull();
    expect(stickOf(new Set(['KeyA', 'ArrowLeft']))).toBe(512); // the same way twice is once
    expect(stickOf(new Set(['ShiftLeft']))).toBeNull();
  });
});

describe('the scoreboard', () => {
  const entry = (id: number, score: number): RosterEntry => ({
    id,
    bot: id > 100,
    score,
    name: `p${id}`,
  });
  const roster = [1, 2, 3, 4, 5, 6, 7].map((id) => entry(id, 10 - id));

  it('shows the top five, ties by who joined first', () => {
    const { top, me } = rank([...roster, entry(9, 9)], 1);
    expect(top.map((r) => r.e.id)).toEqual([1, 9, 2, 3, 4]);
    expect(me).toBeNull();
  });

  it('adds your own place when you are below them', () => {
    const { top, me } = rank(roster, 7);
    expect(top).toHaveLength(5);
    expect(me).toEqual({ place: 7, e: entry(7, 3) });
  });
});

describe('the stress picture', () => {
  it('is twelve tanks and thirty-six shells, all inside the arena', () => {
    const next = stress(16_384);
    let pic = next(0);
    for (let t = 16; t < 5000; t += 16) pic = next(t);
    expect((pic.me ? 1 : 0) + pic.others.length).toBe(12);
    expect(pic.shells).toHaveLength(36);
    for (const s of pic.shells) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(16_384);
    }
  });
});
