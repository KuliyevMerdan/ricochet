import { nearestDir } from '@ricochet/geom';
import type { Intent } from '@ricochet/netcode';

/** The keys that drive, by `KeyboardEvent.code` — WASD and the arrows, so any layout works. */
const AXES: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** The stick the held keys make: a direction, or `null` when they cancel or none is held. */
export function stickOf(held: ReadonlySet<string>): number | null {
  let x = 0;
  let y = 0;
  for (const code of held) {
    const a = AXES[code];
    if (!a) continue;
    x += a[0];
    y += a[1];
  }
  return nearestDir(Math.sign(x), Math.sign(y));
}

/**
 * Keyboard and mouse — the one scheme C1 needs to drive; C2 puts touch sticks and a gamepad behind
 * the same `intent()`. The aim is from the own tank to the pointer, in the world, so the page asks
 * `aimFrom` (the renderer's camera knows where the pointer is) at the moment an input is sampled.
 */
export class KeyboardMouse {
  private readonly held = new Set<string>();
  private firing = false;
  private aim = 0;

  constructor(
    target: HTMLElement,
    /** The pointer's offset from the own tank, world units; `null` while there is no tank. */
    private readonly aimFrom: () => { x: number; y: number } | null,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code in AXES || e.code === 'Space') e.preventDefault();
      if (e.code === 'Space') this.firing = true;
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.firing = false;
      this.held.delete(e.code);
    });
    // A window that loses focus never hears its keys go up.
    window.addEventListener('blur', () => {
      this.held.clear();
      this.firing = false;
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.firing = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  intent(): Intent {
    const off = this.aimFrom();
    if (off) this.aim = nearestDir(Math.round(off.x * 8), Math.round(off.y * 8)) ?? this.aim;
    return { aim: this.aim, move: stickOf(this.held), fire: this.firing };
  }

  /** The aim the last input carried — what the camera leads toward. */
  get lastAim(): number {
    return this.aim;
  }
}
