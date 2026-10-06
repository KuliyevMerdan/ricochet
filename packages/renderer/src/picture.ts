import type { Box } from '@ricochet/geom';

/**
 * What the renderer draws — pictures, not messages (CLAUDE.md § Dependency rules: `renderer` may not
 * import `protocol`). Lengths are the world's **eighths** of a unit and directions its 1,024ths of a
 * turn, both fractional here: a picture is between ticks. The page fills these from
 * `netcode.frame(now)`; a test or a stress run fills them by hand.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface TankPicture {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly hull: number;
  readonly turret: number;
  readonly alive: boolean;
  readonly shield: boolean;
}

export interface ShellPicture {
  readonly id: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
}

/**
 * Something to show once — `netcode`'s effects, in the renderer's own terms. A hit, a kill and a
 * spawn are the server's word, never a guess from where a shell vanished (ROADMAP C2).
 */
export type EffectPicture =
  | {
      readonly kind: 'fire';
      readonly x: number;
      readonly y: number;
      readonly dir: number;
      readonly owner: number;
    }
  | { readonly kind: 'hit'; readonly x: number; readonly y: number; readonly victim: number }
  | { readonly kind: 'kill'; readonly x: number; readonly y: number; readonly victim: number }
  | { readonly kind: 'spawn'; readonly x: number; readonly y: number; readonly tank: number }
  | { readonly kind: 'end'; readonly x: number; readonly y: number; readonly owner: number }
  | { readonly kind: 'fizzle'; readonly x: number; readonly y: number }
  | { readonly kind: 'crate'; readonly spot: number };

/** One frame's picture. */
export interface Picture {
  /** The own tank, drawn on top and followed by the camera; `null` before there is one. */
  readonly me: TankPicture | null;
  readonly others: readonly TankPicture[];
  readonly shells: readonly ShellPicture[];
  /** A bit per crate spot holding a crate (the spots are the arena's). */
  readonly crates: number;
  /** What came due since the last picture, to show once. */
  readonly effects: readonly EffectPicture[];
  /** Where the player aims, as a direction — the camera leads toward it. `null`: no lead. */
  readonly aim: number | null;
  /**
   * The server ghost (C3): outlines of tanks where the newest snapshot puts them, drawn over the
   * tanks themselves — empty when it is off. The own one is white, the others in their colours.
   */
  readonly ghosts: readonly TankPicture[];
}

/** The arena as the renderer needs it: its side, its walls and its crate spots, in eighths. */
export interface ArenaPicture {
  readonly size: number;
  readonly walls: readonly Box[];
  readonly crates: readonly Point[];
}

/** Eighths to the renderer's world pixels: one unit, one pixel at zoom 1. */
export const PX = 1 / 8;

/** A direction in 1,024ths of a turn to radians — clockwise on screen, as the world's are. */
export function radians(dir: number): number {
  return (dir / 1024) * 2 * Math.PI;
}
