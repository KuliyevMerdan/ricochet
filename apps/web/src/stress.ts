import type { Picture, ShellPicture, TankPicture } from '@ricochet/renderer';

/**
 * ROADMAP C1's load, without a server: twelve tanks circling and thirty-six shells in the air, every
 * one of them fired, bounced off the arena's edge and spent on the way, so the renderer draws the
 * done-when's worst case and every effect in it. The perf script opens the page with `?stress`.
 * Objects are reused from frame to frame: what is measured is the renderer, not this.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const TANKS = 12;
const SHELLS = 36;
/** A shell's life, ms — the rule's 1.6 s. */
const LIFE = 1600;
/** Shell speed, eighths a millisecond — 600 units a second. */
const SPEED = (600 * 8) / 1000;

export function stress(size: number): (now: number) => Picture {
  const tanks: Mutable<TankPicture>[] = Array.from({ length: TANKS }, (_, i) => ({
    id: i + 1,
    x: 0,
    y: 0,
    hull: 0,
    turret: 0,
    alive: true,
    shield: i % 5 === 0,
  }));
  const shells: (Mutable<ShellPicture> & { born: number; vx: number; vy: number })[] = [];
  let nextShell = 1;
  const picture: Mutable<Picture> = {
    me: null,
    others: [],
    shells,
    crates: 0b1111,
    effects: [],
    aim: null,
    ghosts: [],
  };
  const [me, ...others] = tanks;
  picture.me = me ?? null;
  picture.others = others;

  const fire = (s: (typeof shells)[number] | undefined, now: number, i: number) => {
    const t = tanks[i % TANKS];
    if (!t) return;
    const a = (t.turret / 1024) * 2 * Math.PI;
    const shell = s ?? { id: 0, owner: 0, x: 0, y: 0, dir: 0, born: 0, vx: 0, vy: 0 };
    shell.id = nextShell++;
    shell.owner = t.id;
    shell.x = t.x + Math.cos(a) * 256;
    shell.y = t.y + Math.sin(a) * 256;
    shell.dir = Math.round(t.turret) % 1024;
    shell.vx = Math.cos(a) * SPEED;
    shell.vy = Math.sin(a) * SPEED;
    shell.born = now - (i * LIFE) / SHELLS; // staggered, so they do not all die together
    if (!s) shells.push(shell);
  };

  let last = 0;
  return (now) => {
    const dt = last ? Math.min(100, now - last) : 0;
    last = now;
    const c = size / 2;
    tanks.forEach((t, i) => {
      const a = now / 4000 + (i / TANKS) * 2 * Math.PI;
      const r = size * (0.15 + 0.2 * ((i % 3) / 2));
      t.x = c + Math.cos(a) * r;
      t.y = c + Math.sin(a) * r;
      t.hull = ((((a / (2 * Math.PI)) * 1024 + 256) % 1024) + 1024) % 1024;
      t.turret = (now / 3 + i * 85) % 1024;
    });
    if (shells.length < SHELLS)
      for (let i = shells.length; i < SHELLS; i++) fire(undefined, now, i);
    shells.forEach((s, i) => {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // Off the arena's edge, once: the direction flips like a ricochet's.
      if (s.x < 400 || s.x > size - 400) {
        s.vx = -s.vx;
        s.dir = (1536 - s.dir) % 1024;
      }
      if (s.y < 400 || s.y > size - 400) {
        s.vy = -s.vy;
        s.dir = (1024 - s.dir) % 1024;
      }
      if (now - s.born > LIFE) fire(s, now, i);
    });
    picture.aim = me ? me.turret : null;
    return picture;
  };
}
