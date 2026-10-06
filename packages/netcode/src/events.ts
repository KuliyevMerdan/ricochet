import type { Arena, ShellAt, View } from '@ricochet/protocol';
import { flyTick } from '@ricochet/sim';
import type { ShellBody } from '@ricochet/sim';
import type { Effect } from './own.js';

/**
 * The server's events, shown when the drawn time reaches them (ROADMAP C2): the others are drawn
 * ~100 ms in the past, so a hit on one shows when that tank, drawn, is where it was struck. A hit,
 * a kill, a spawn, a crate taken — each from its event, never inferred. An other's shell that is
 * gone from a view without a hit ended on its own: its flight says where, as the server's did.
 * The own shells' hits are `OwnShells`', shown as their snapshot arrives, in the present they fly in
 * — unless the prediction is switched off (C3's lab), when the own shells are the server's like
 * everyone else's: their shots, hits and ends shown here, at the drawn time.
 */
export class Happenings {
  /** The last view whose events were shown; `null` until the drawn time first starts. */
  private done: number | null = null;

  constructor(private readonly arena: Arena) {}

  update(
    views: readonly View[],
    drawn: number,
    you: number,
    me: { readonly x: number; readonly y: number } | null,
    out: Effect[],
    predicted = true,
  ): void {
    if (this.done === null) {
      this.done = Math.floor(drawn);
      return;
    }
    let prev: View | null = null;
    for (const v of views) {
      if (v.tick > drawn) break;
      if (v.tick <= this.done) {
        prev = v;
        continue;
      }
      this.show(prev, v, predicted ? you : null, me, out);
      this.done = v.tick;
      prev = v;
    }
  }

  reset(): void {
    this.done = null;
  }

  /** Nothing up to `tick` is shown — the time a hidden page was away (ROADMAP P0). */
  skipTo(tick: number): void {
    this.done = Math.max(this.done ?? tick, tick);
  }

  /** `you` is `null` when the own shells are not predicted: then they are shown as the others'. */
  private show(
    prev: View | null,
    v: View,
    you: number | null,
    me: { readonly x: number; readonly y: number } | null,
    out: Effect[],
  ): void {
    const shellOf = new Map<number, ShellAt>();
    for (const s of prev?.shells ?? []) shellOf.set(s.id, s);
    for (const s of v.shells) shellOf.set(s.id, s);
    const where = (id: number) => {
      if (id === you && me) return me;
      return v.tanks.find((t) => t.id === id) ?? prev?.tanks.find((t) => t.id === id) ?? null;
    };
    const struck = new Set<number>();
    for (const e of v.events) {
      switch (e.type) {
        case 'hit': {
          struck.add(e.shell);
          if (shellOf.get(e.shell)?.owner === you) break; // the own shell's: shown on arrival
          const at = where(e.victim);
          if (at)
            out.push({ kind: 'hit', x: at.x, y: at.y, victim: e.victim, hp: e.hp, shell: e.shell });
          break;
        }
        case 'kill': {
          const at = where(e.victim);
          if (at) out.push({ kind: 'kill', x: at.x, y: at.y, killer: e.killer, victim: e.victim });
          break;
        }
        case 'spawn': {
          const at = where(e.tank);
          if (at) out.push({ kind: 'spawn', x: at.x, y: at.y, tank: e.tank });
          break;
        }
        case 'crate':
          out.push({ kind: 'crate', spot: e.spot, tank: e.tank });
          break;
        case 'shot': {
          // Sent to the shooter only: with no prediction, the own muzzle flash is the server's word.
          const s = you === null ? shellOf.get(e.shell) : undefined;
          const at = s ? where(e.tank) : null;
          if (s && at) out.push({ kind: 'fire', x: at.x, y: at.y, dir: s.dir, owner: e.tank });
          break;
        }
      }
    }
    if (!prev) return;
    const now = new Set(v.shells.map((s) => s.id));
    for (const s of prev.shells) {
      if (s.owner === you || now.has(s.id) || struck.has(s.id)) continue;
      const end = endBy(s, v.tick, this.arena);
      if (end) out.push({ kind: 'end', x: end.x, y: end.y, owner: s.owner });
    }
  }
}

/** Where a shell's own flight ended, if it did by `tick` — or `null`: it only left the view. */
function endBy(s: ShellAt, tick: number, arena: Arena): ShellBody | null {
  let b: ShellBody = {
    id: s.id,
    owner: s.owner,
    x: s.x,
    y: s.y,
    dir: s.dir,
    bounced: s.bounced,
    age: s.age,
  };
  for (let t = s.at; t < tick; t++) {
    const r = flyTick(b, arena, null);
    if (r.fate.kind !== 'flying') return r.shell;
    b = r.shell;
  }
  return null;
}
