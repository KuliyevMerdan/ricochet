import type { Point } from './picture.js';
import { PX, radians } from './picture.js';

/** The camera shows at most this many units from its centre on either axis (protocol § 8.3). */
export const VIEW_HALF = 640;
/** How far the camera leads its tank toward the aim, units (protocol § 8.3). */
export const LEAD = 80;
/** The lead follows the aim with this time constant, ms: quick, but not a twitch. */
const LEAD_MS = 120;

/**
 * The zoom that shows no more than `VIEW_HALF` units from the centre on either axis of a canvas
 * `width` × `height` pixels — the longer axis decides, so a phone held either way sees as far along
 * its long side as a desktop does, and less across.
 */
export function zoomFor(width: number, height: number): number {
  return Math.max(width, height) / (2 * VIEW_HALF);
}

/**
 * Where the camera looks: the own tank, plus a lead toward the aim that eases in and out rather than
 * jumping when the aim swings. Pure arithmetic on what it is handed — the frame's elapsed time
 * included — so it is the same at 30 frames a second as at 144.
 */
export class CameraRig {
  private lx = 0;
  private ly = 0;

  /** The point to centre on, world pixels, for the own tank at `me` (eighths) aiming `aim`. */
  update(me: Point, aim: number | null, dtMs: number): Point {
    const tx = aim === null ? 0 : Math.cos(radians(aim)) * LEAD;
    const ty = aim === null ? 0 : Math.sin(radians(aim)) * LEAD;
    const k = 1 - Math.exp(-Math.max(0, dtMs) / LEAD_MS);
    this.lx += (tx - this.lx) * k;
    this.ly += (ty - this.ly) * k;
    return { x: me.x * PX + this.lx, y: me.y * PX + this.ly };
  }

  /** The lead now, units. */
  get lead(): Point {
    return { x: this.lx, y: this.ly };
  }

  reset(): void {
    this.lx = 0;
    this.ly = 0;
  }
}
