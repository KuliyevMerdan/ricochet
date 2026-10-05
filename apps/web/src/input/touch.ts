import { nearestDir } from '@ricochet/geom';
import type { Intent } from '@ricochet/netcode';

/** A stick's travel, CSS pixels, by the player's size setting. */
export const STICK_SIZES = { s: 44, m: 58, l: 74 } as const;
export type StickSize = keyof typeof STICK_SIZES;

/** Pushed less than this of its travel, a stick is at rest; the aim stick fires past `FIRE`. */
const DEAD = 0.2;
const FIRE = 0.55;

/** A stick's offset as a fraction of its travel: a direction past the dead zone, and how far. */
export function stickVector(
  dx: number,
  dy: number,
  travel: number,
): { dir: number | null; push: number } {
  const len = Math.hypot(dx, dy);
  const push = Math.min(1, len / travel);
  if (push < DEAD) return { dir: null, push };
  return { dir: nearestDir(Math.round(dx * 64), Math.round(dy * 64)), push };
}

interface Stick {
  readonly base: HTMLElement;
  readonly knob: HTMLElement;
  pointer: number | null;
  ox: number;
  oy: number;
  dir: number | null;
  push: number;
}

/**
 * Two thumb sticks on a touch screen: the one on the move side drives, the other aims and fires
 * while pushed past `FIRE` of its travel (ROADMAP C2). Each appears where its thumb lands, in its
 * half of the screen, and rests faintly in its corner otherwise. The side of the move stick and the
 * sticks' size are the player's settings.
 */
export class TouchSticks {
  private readonly move: Stick;
  private readonly aimStick: Stick;
  private aim = 0;
  private latched = false;
  private travel: number = STICK_SIZES.m;
  private moveOnLeft = true;

  constructor(
    private readonly root: HTMLElement,
    used: () => void,
  ) {
    this.move = this.stick('move');
    this.aimStick = this.stick('aim');
    // On the window, not the sticks' layer: the first touch is what shows them, wherever it lands.
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.target instanceof Element && e.target.closest('button, input, select, label, form'))
        return;
      const left = e.clientX < window.innerWidth / 2;
      const s = left === this.moveOnLeft ? this.move : this.aimStick;
      if (s.pointer !== null) return;
      s.pointer = e.pointerId;
      s.ox = e.clientX;
      s.oy = e.clientY;
      this.place(s, e.clientX, e.clientY, 0, 0);
      used();
    });
    window.addEventListener('pointermove', (e) => {
      for (const s of [this.move, this.aimStick]) {
        if (s.pointer !== e.pointerId) continue;
        const v = stickVector(e.clientX - s.ox, e.clientY - s.oy, this.travel);
        s.dir = v.dir;
        s.push = v.push;
        if (s === this.aimStick && v.dir !== null) this.aim = v.dir;
        if (s === this.aimStick && v.push >= FIRE) this.latched = true;
        const k = Math.min(
          1,
          this.travel / Math.max(1, Math.hypot(e.clientX - s.ox, e.clientY - s.oy)),
        );
        this.place(s, s.ox, s.oy, (e.clientX - s.ox) * k, (e.clientY - s.oy) * k);
      }
    });
    const up = (e: PointerEvent) => {
      for (const s of [this.move, this.aimStick]) {
        if (s.pointer !== e.pointerId) continue;
        s.pointer = null;
        s.dir = null;
        s.push = 0;
        this.rest(s);
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Show the resting sticks — only once the screen has been touched. */
  show(on: boolean): void {
    this.root.hidden = !on;
    if (on) {
      this.rest(this.move);
      this.rest(this.aimStick);
    }
  }

  configure(size: StickSize, moveSide: 'left' | 'right'): void {
    this.travel = STICK_SIZES[size];
    this.moveOnLeft = moveSide === 'left';
    for (const s of [this.move, this.aimStick]) {
      s.base.style.width = s.base.style.height = `${this.travel * 2}px`;
      s.knob.style.width = s.knob.style.height = `${this.travel}px`;
      this.rest(s);
    }
  }

  intent(take: boolean): Intent {
    const fire = this.aimStick.push >= FIRE || this.latched;
    if (take) this.latched = false;
    return { aim: this.aim, move: this.move.dir, fire };
  }

  private stick(name: string): Stick {
    const base = document.createElement('div');
    base.className = `stick ${name}`;
    const knob = document.createElement('div');
    knob.className = 'knob';
    base.append(knob);
    this.root.append(base);
    return { base, knob, pointer: null, ox: 0, oy: 0, dir: null, push: 0 };
  }

  private place(s: Stick, x: number, y: number, kx: number, ky: number): void {
    s.base.style.transform = `translate(${x - this.travel}px, ${y - this.travel}px)`;
    s.knob.style.transform = `translate(${this.travel / 2 + kx}px, ${this.travel / 2 + ky}px)`;
    s.base.classList.toggle('active', s.pointer !== null);
  }

  /** A stick at rest in its corner, faint. */
  private rest(s: Stick): void {
    const onLeft = (s === this.move) === this.moveOnLeft;
    const m = this.travel + 28;
    const x = onLeft ? m : window.innerWidth - m;
    this.place(s, x, window.innerHeight - m, 0, 0);
  }
}
