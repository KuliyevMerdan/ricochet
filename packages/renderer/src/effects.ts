import type { ShellPicture, TankPicture } from './picture.js';

/** A shell first seen within this of its owner's centre, eighths, was fired in view: the muzzle
 * (256) and up to three ticks of fast-forward and a frame's flight (ADR-0002). */
const FIRED_WITHIN = 256 + 4 * 160;
/** A shell gone within this of a live tank's centre, eighths, ended in it: tank and shell radii,
 * and a tick of flight. */
const HIT_WITHIN = 192 + 48 + 160;

/** What happened to the shells between two pictures. Positions in eighths. */
export interface ShellEvents {
  /** A shell fired in view: at its owner, along the turret. */
  fired(x: number, y: number, dir: number, owner: number): void;
  /** A shell's direction changed: it met a wall. */
  bounced(x: number, y: number): void;
  /** A shell gone: `hit` when it ended in a tank, else a wall or its life. */
  gone(x: number, y: number, hit: boolean, owner: number): void;
}

interface Seen {
  x: number;
  y: number;
  dir: number;
  owner: number;
  /** The pass that last saw it. */
  pass: number;
}

/**
 * Finds the effects in a stream of pictures — a muzzle flash, a ricochet's sparks, a shell's end —
 * by comparing each picture's shells with the last one's. The renderer draws pictures; this is how
 * it knows when one changed. Hits are inferred from where a shell vanished, for the sparks only:
 * C2's hit points come from the server's events.
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
        const r = this.spare.pop() ?? { x: 0, y: 0, dir: 0, owner: 0, pass: 0 };
        r.x = s.x;
        r.y = s.y;
        r.dir = s.dir;
        r.owner = s.owner;
        r.pass = pass;
        this.seen.set(s.id, r);
        if (!this.first) {
          const o = s.owner === me?.id ? me : tanks.find((t) => t.id === s.owner);
          if (o && o.alive && near(o, s.x, s.y, FIRED_WITHIN)) on.fired(o.x, o.y, o.turret, o.id);
        }
        continue;
      }
      // A shell's direction is a whole 1,024th that changes only off a wall.
      if (s.dir !== was.dir) on.bounced(s.x, s.y);
      was.x = s.x;
      was.y = s.y;
      was.dir = s.dir;
      was.pass = pass;
    }
    for (const [id, r] of this.seen) {
      if (r.pass === pass) continue;
      const hit =
        (me !== null && me.alive && near(me, r.x, r.y, HIT_WITHIN)) ||
        tanks.some((t) => t.alive && near(t, r.x, r.y, HIT_WITHIN));
      on.gone(r.x, r.y, hit, r.owner);
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
