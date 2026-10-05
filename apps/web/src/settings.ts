import type { StickSize } from './input/touch.js';

/** What the player sets, remembered between visits (ROADMAP C2). */
export interface Settings {
  readonly sound: boolean;
  readonly stickSize: StickSize;
  /** The side the move stick is on; the aim stick takes the other. */
  readonly moveSide: 'left' | 'right';
  readonly overlay: boolean;
}

export const DEFAULTS: Settings = { sound: true, stickSize: 'm', moveSide: 'left', overlay: false };

const KEY = 'ricochet.settings';

/** The stored settings, each field checked: anything missing or not one of its values is the
 * default — a stored value is input like any other. */
export function parseSettings(raw: string | null): Settings {
  let v: unknown = null;
  try {
    v = raw === null ? null : JSON.parse(raw);
  } catch {
    v = null;
  }
  const get = (k: string): unknown =>
    typeof v === 'object' && v !== null ? Reflect.get(v, k) : undefined;
  const sound = get('sound');
  const size = get('stickSize');
  const side = get('moveSide');
  const overlay = get('overlay');
  return {
    sound: typeof sound === 'boolean' ? sound : DEFAULTS.sound,
    stickSize: size === 's' || size === 'm' || size === 'l' ? size : DEFAULTS.stickSize,
    moveSide: side === 'left' || side === 'right' ? side : DEFAULTS.moveSide,
    overlay: typeof overlay === 'boolean' ? overlay : DEFAULTS.overlay,
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return DEFAULTS; // storage refused: a private window
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // As above: kept for this visit only.
  }
}
