import type { Intent } from '@ricochet/netcode';
import { stickVector } from './touch.js';

/** An axis inside this is at rest — worn sticks drift. */
const DEAD = 0.25;
/** The standard mapping's buttons that fire: A, the right bumper, the right trigger. */
const FIRE_BUTTONS = [0, 5, 7];

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
    const ax = (i: number) => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < DEAD ? 0 : v;
    };
    const move = stickVector(ax(0), ax(1), 1);
    const look = stickVector(ax(2), ax(3), 1);
    if (look.dir !== null) this.aim = look.dir;
    const fire = FIRE_BUTTONS.some((b) => pad.buttons[b]?.pressed ?? false);
    const touched = move.dir !== null || look.dir !== null || fire;
    return { intent: { aim: this.aim, move: move.dir, fire }, touched };
  }
}
