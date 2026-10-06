import type { Intent } from '@ricochet/netcode';
import { stickVector } from './touch.js';

/** A stick pushed less than this is at rest — worn sticks drift. */
const DEAD = 0.25;
/** The standard mapping's buttons that fire: A, the right bumper, the right trigger. */
const FIRE_BUTTONS = [0, 5, 7];

/**
 * A stick's direction from its two axes, or `null` at rest. The dead zone is the stick's push, not
 * each axis's: cut axis by axis, an aim within 14° of the horizontal lost its vertical part and
 * snapped flat — P1's E2E found a gamepad unable to hit a tank 427 units away at 11° below level.
 */
export function stickOf(x: number, y: number): number | null {
  return Math.hypot(x, y) < DEAD ? null : stickVector(x, y, 1).dir;
}

/**
 * A gamepad through the Gamepad API's standard mapping: the left stick drives, the right aims, A or
 * the right bumper or trigger fires. Polled when an input is sampled; `active` says whether it was
 * touched since the last poll, which makes it the scheme in use.
 */
export class Pad {
  private aim = 0;

  /** The intent from the first connected pad, and whether it is being touched; `null` with none. */
  read(): { intent: Intent; touched: boolean } | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads.find((p) => p?.connected && p.mapping === 'standard') ?? null;
    if (!pad) return null;
    const ax = (i: number) => pad.axes[i] ?? 0;
    const move = stickOf(ax(0), ax(1));
    const look = stickOf(ax(2), ax(3));
    if (look !== null) this.aim = look;
    const fire = FIRE_BUTTONS.some((b) => pad.buttons[b]?.pressed ?? false);
    const touched = move !== null || look !== null || fire;
    return { intent: { aim: this.aim, move, fire }, touched };
  }
}
