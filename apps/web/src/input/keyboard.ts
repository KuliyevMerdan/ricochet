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
 * Keyboard and mouse: WASD or the arrows drive, the pointer aims — from the own tank to it, in the
 * world, which the renderer's camera knows (`aimFrom`) — and the left button or Space fires. A
 * press is latched until an input carries it, so a click shorter than a tick still fires.
 */
export class KeyboardMouse {
  private readonly held = new Set<string>();
  private firing = false;
  private latched = false;
  private aim = 0;

  constructor(
    target: HTMLElement,
    /** The pointer's offset from the own tank, world units; `null` while there is no tank. */
    private readonly aimFrom: () => { x: number; y: number } | null,
    /** Told whenever this scheme is touched — the page switches to it. */
    used: () => void,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code in AXES || e.code === 'Space') e.preventDefault();
      if (e.code === 'Space' && !e.repeat) this.press();
      this.held.add(e.code);
      used();
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
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      this.press();
      used();
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') used();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.firing = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private press(): void {
    this.firing = true;
    this.latched = true;
  }

  /** The intent now; `take` consumes a latched press — the input that carries it does. */
  intent(take: boolean): Intent {
    const off = this.aimFrom();
    if (off) this.aim = nearestDir(Math.round(off.x * 8), Math.round(off.y * 8)) ?? this.aim;
    const fire = this.firing || this.latched;
    if (take) this.latched = false;
    return { aim: this.aim, move: stickOf(this.held), fire };
  }
}
