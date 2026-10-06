import { RULES } from '@ricochet/protocol';

/* The kill replay's time and framing (ROADMAP C3) — arithmetic, apart from the canvas that uses it. */

/** The replay runs at this share of real time. */
export const SPEED = 0.5;
/** It holds its last frame this long, ms, before it may close. */
export const HOLD_MS = 1500;
/** The least the replay shows either side of its centre, and the margin round what it frames —
 * eighths (500 and 160 units). */
export const MIN_HALF = 4000;
const MARGIN = 1280;

/** A square of the arena, eighths: its centre and half its side. */
export interface Framing {
  readonly x: number;
  readonly y: number;
  readonly half: number;
}

/** What the replay frames: where the tank died, the path of the shell that killed it, and where
 * the killer stood when the replay begins — the whole story in one square. */
export function frameFor(points: readonly { readonly x: number; readonly y: number }[]): Framing {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (x0 > x1) return { x: 0, y: 0, half: MIN_HALF };
  const half = Math.max(MIN_HALF, (x1 - x0) / 2 + MARGIN, (y1 - y0) / 2 + MARGIN);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, half };
}

/** The replay's tick at `elapsed` ms of playing — slowed, and held at its end. */
export function replayTick(r: { readonly from: number; readonly to: number }, elapsed: number) {
  return Math.min(r.to, r.from + (elapsed / 1000) * RULES.tickHz * SPEED);
}
