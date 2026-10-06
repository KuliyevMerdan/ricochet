import type { RosterEntry } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { MIN_HALF, frameFor, replayTick } from './framing.js';
import { History, SAMPLE_HZ, SECONDS } from './graph.js';
import { stickOf } from './input/keyboard.js';
import { msOf } from './lab.js';
import { stickVector } from './input/touch.js';
import { DEFAULTS, parseSettings } from './settings.js';
import { killLine } from './hud.js';
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

describe('the touch sticks', () => {
  it('rest inside the dead zone, then point where pushed and say how far', () => {
    expect(stickVector(5, 5, 60).dir).toBeNull();
    expect(stickVector(60, 0, 60)).toEqual({ dir: 0, push: 1 });
    expect(stickVector(0, -30, 60)).toEqual({ dir: 768, push: 0.5 });
    expect(stickVector(500, 500, 60)).toEqual({ dir: 128, push: 1 }); // past the travel: full
  });
});

describe('the settings', () => {
  it('are read field by field, anything unknown the default', () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings('not json')).toEqual(DEFAULTS);
    expect(
      parseSettings('{"sound":false,"stickSize":"l","moveSide":"right","overlay":true}'),
    ).toEqual({
      sound: false,
      stickSize: 'l',
      moveSide: 'right',
      overlay: true,
    });
    expect(parseSettings('{"sound":"yes","stickSize":"xl","moveSide":1}')).toEqual(DEFAULTS);
  });
});

describe('the kill feed', () => {
  it('names the killer and the victim from the roster, and a tank that shot itself once', () => {
    const roster: RosterEntry[] = [
      { id: 1, bot: false, score: 0, name: 'Ann' },
      { id: 2, bot: true, score: 0, name: 'Rook' },
    ];
    expect(killLine(roster, 1, 2)).toEqual({ killer: 'Ann', victim: 'Rook', self: false });
    expect(killLine(roster, 2, 2)).toEqual({ killer: 'Rook', victim: 'Rook', self: true });
    expect(killLine(roster, 9, 1).killer).toBe('#9'); // left the room since
  });
});

describe('the overlay graph', () => {
  const sample = (rttMs: number | null, fixUnits = 0) => ({
    rttMs,
    delayMs: 66,
    bufferMs: 40,
    fixUnits,
  });

  it('keeps the last ten seconds and drops the oldest', () => {
    const h = new History();
    for (let i = 0; i < SAMPLE_HZ * SECONDS + 5; i++) h.push(sample(i));
    expect(h.samples).toHaveLength(SAMPLE_HZ * SECONDS);
    expect(h.samples[0]?.rttMs).toBe(5);
  });

  it('scales to its largest line by hundreds, at least 200 ms, and its bars on their own', () => {
    const h = new History();
    h.push(sample(null));
    expect(h.scaleMs()).toBe(200);
    expect(h.scaleUnits()).toBe(8);
    h.push(sample(312, 20.5));
    expect(h.scaleMs()).toBe(400);
    expect(h.scaleUnits()).toBe(21);
  });
});

describe('the lab', () => {
  it('reads a radio value as whole milliseconds, anything else as none', () => {
    expect(msOf('300')).toBe(300);
    expect(msOf(null)).toBe(0);
    expect(msOf('-5')).toBe(0);
    expect(msOf('1.5')).toBe(0);
    expect(msOf('x')).toBe(0);
  });
});

describe('the kill replay', () => {
  it('plays at half speed and holds its last tick', () => {
    const r = { from: 100, to: 190 };
    expect(replayTick(r, 0)).toBe(100);
    expect(replayTick(r, 1000)).toBe(115); // a second of watching, half a second of play
    expect(replayTick(r, 60_000)).toBe(190);
  });

  it('frames the death, the shell’s path and the killer in one square, never too close', () => {
    expect(frameFor([{ x: 8000, y: 8000 }])).toEqual({ x: 8000, y: 8000, half: MIN_HALF });
    const f = frameFor([
      { x: 2000, y: 3000 },
      { x: 12_000, y: 5000 },
      { x: 6000, y: 4000 },
    ]);
    expect(f.x).toBe(7000);
    expect(f.y).toBe(4000);
    expect(f.half).toBe(5000 + 1280); // the wider side, and a margin
  });
});
