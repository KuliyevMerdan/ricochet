import type { ShellPicture, TankPicture } from './picture.js';

/** A shell first seen within this of its owner's centre, eighths, was fired in view: the muzzle
 * (256) and up to three ticks of fast-forward and a frame's flight (ADR-0002). */
const FIRED_WITHIN = 256 + 4 * 160;

/** What the pictures show of the others' shells between two frames. Positions in eighths. */
export interface ShellEvents {
  /** An other's shell fired in view: at its owner, along the turret. */
  fired(x: number, y: number, dir: number, owner: number): void;
  /** A shell's direction changed: it met a wall. */
  bounced(x: number, y: number): void;
}

interface Seen {
  dir: number;
  /** The pass that last saw it. */
  pass: number;
}

/**
 * The muzzle flashes and ricochet sparks the pictures imply, found by comparing each picture's
 * shells with the last one's: an other's shell new beside its owner was just fired, and a direction
 * that changed met a wall. The own shots' flashes, every hit, kill and shell's end are `netcode`'s
 * effects instead — a hit is never inferred from where a shell vanished.
 *
 * Steady play allocates nothing: a shell's record is reused after it is gone.
 */
export class ShellWatch {
  private readonly seen = new Map<number, Seen>();
  private readonly spare: Seen[] = [];
  private pass = 0;
  private first = true;

  update(
    shells: readonly ShellPicture[],
    tanks: readonly TankPicture[],
    me: TankPicture | null,
    on: ShellEvents,
  ): void {
    const pass = ++this.pass;
    for (const s of shells) {
      const was = this.seen.get(s.id);
      if (!was) {
        const r = this.spare.pop() ?? { dir: 0, pass: 0 };
        r.dir = s.dir;
        r.pass = pass;
        this.seen.set(s.id, r);
        if (!this.first && s.owner !== me?.id) {
          const o = tanks.find((t) => t.id === s.owner);
          if (o && o.alive && near(o, s.x, s.y, FIRED_WITHIN)) on.fired(o.x, o.y, o.turret, o.id);
        }
        continue;
      }
      // A shell's direction is a whole 1,024th that changes only off a wall.
      if (s.dir !== was.dir) on.bounced(s.x, s.y);
      was.dir = s.dir;
      was.pass = pass;
    }
    for (const [id, r] of this.seen) {
      if (r.pass === pass) continue;
      this.seen.delete(id);
      this.spare.push(r);
    }
    this.first = false;
  }

  reset(): void {
    for (const r of this.seen.values()) this.spare.push(r);
    this.seen.clear();
    this.first = true;
  }
}

function near(t: { readonly x: number; readonly y: number }, x: number, y: number, d: number) {
  const dx = t.x - x;
  const dy = t.y - y;
  return dx * dx + dy * dy <= d * d;
}
