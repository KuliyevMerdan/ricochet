import type { Client } from '@ricochet/netcode';
import { RULES } from '@ricochet/protocol';
import type { GameEvent, RosterEntry, View } from '@ricochet/protocol';
import type { Settings } from './settings.js';
import { saveSettings } from './settings.js';

/**
 * The DOM over the arena that C2 adds: the kill feed, the death screen — who did it and the count
 * to the respawn — the settings, and a small network overlay (C3 grows it). Names are the roster's,
 * set as text: a name is never markup.
 */

const $ = <T extends HTMLElement>(sel: string, ctor: new () => T): T => {
  const el = document.querySelector(sel);
  if (!(el instanceof ctor)) throw new Error(`the page has no ${sel}`);
  return el;
};

const nameOf = (roster: readonly RosterEntry[], id: number) =>
  roster.find((e) => e.id === id)?.name ?? `#${id}`;

/** How long a kill stays in the feed, ms, and how many it shows. */
const FEED_MS = 5000;
const FEED_MAX = 4;

/** The feed's lines for a kill: who, whom — the same name twice is a tank that shot itself. */
export function killLine(
  roster: readonly RosterEntry[],
  killer: number,
  victim: number,
): { killer: string; victim: string; self: boolean } {
  return {
    killer: nameOf(roster, killer),
    victim: nameOf(roster, victim),
    self: killer === victim,
  };
}

export class Hud {
  private readonly feed = $('#feed', HTMLUListElement);
  private readonly death = $('#death', HTMLElement);
  private readonly deathBy = $('#death-by', HTMLElement);
  private readonly deathIn = $('#death-in', HTMLElement);
  private readonly overlay = $('#overlay', HTMLPreElement);
  /** Who killed the own tank last, while it is dead. */
  private killer: number | null = null;
  private lastFrames = 0;
  private lastAt = 0;
  private fps = 0;
  private lastBytes = { in: 0, out: 0, at: 0 };
  private rate = { in: 0, out: 0 };

  constructor(private readonly client: Client) {
    client.onEvents((events) => this.events(events));
  }

  private events(events: readonly GameEvent[]): void {
    for (const e of events) {
      if (e.type !== 'kill') continue;
      if (e.victim === this.client.you) this.killer = e.killer;
      const line = killLine(this.client.roster, e.killer, e.victim);
      const li = document.createElement('li');
      const text = (tag: 'b' | 'span', t: string) => {
        const el = document.createElement(tag);
        el.textContent = t;
        return el;
      };
      if (line.self) li.append(text('span', `${line.victim} self-destructed`));
      else
        li.append(
          text('b', line.killer),
          document.createTextNode(' ✕ '),
          text('span', line.victim),
        );
      if (e.killer === this.client.you && !line.self) li.className = 'mine';
      if (e.victim === this.client.you) li.className = 'me';
      this.feed.prepend(li);
      while (this.feed.children.length > FEED_MAX) this.feed.lastElementChild?.remove();
      setTimeout(() => li.remove(), FEED_MS);
    }
  }

  /** Once a frame: the death screen and, if on, the overlay. */
  update(now: number, view: View | null, frames: number, settings: Settings): void {
    const me = view?.tanks.find((t) => t.id === this.client.you);
    const dead = view !== null && me !== undefined && !me.alive;
    this.death.hidden = !dead;
    if (dead && view) {
      const by = this.killer;
      this.deathBy.textContent =
        by === null
          ? 'Destroyed'
          : by === this.client.you
            ? 'Destroyed by your own ricochet'
            : `Destroyed by ${nameOf(this.client.roster, by)}`;
      this.deathIn.textContent = `Back in ${Math.max(1, Math.ceil(view.self.respawn / RULES.tickHz))}`;
    } else {
      this.killer = null;
    }

    this.overlay.hidden = !settings.overlay;
    if (now - this.lastAt >= 500) {
      const dt = (now - this.lastAt) / 1000;
      if (this.lastAt) this.fps = (frames - this.lastFrames) / dt;
      const st = this.client.stats();
      if (this.lastBytes.at) {
        this.rate = {
          in: (st.bytesIn - this.lastBytes.in) / dt / 1024,
          out: (st.bytesOut - this.lastBytes.out) / dt / 1024,
        };
      }
      this.lastBytes = { in: st.bytesIn, out: st.bytesOut, at: now };
      this.lastFrames = frames;
      this.lastAt = now;
      if (settings.overlay) {
        const s = st.shots;
        this.overlay.textContent = [
          `rtt      ${st.rttMs === null ? '—' : `${Math.round(st.rttMs)} ms`}`,
          `delay    ${Math.round(st.delayMs)} ms`,
          `unacked  ${st.unacked}`,
          `fixes    ${st.corrections}`,
          `shots    ${s.predicted} → ${s.adopted} adopted, ${s.fizzled} fizzled`,
          `step     ${(s.stepMean / 8).toFixed(1)} u mean`,
          `in/out   ${this.rate.in.toFixed(1)} / ${this.rate.out.toFixed(1)} KB/s`,
          `fps      ${Math.round(this.fps)}`,
        ].join('\n');
      }
    }
  }
}

/** The settings panel: a button opens it; every change applies at once and is remembered. */
export function settingsPanel(initial: Settings, apply: (s: Settings) => void): void {
  const panel = $('#settings', HTMLFormElement);
  const open = $('#settings-open', HTMLButtonElement);
  const sound = $('#set-sound', HTMLInputElement);
  const overlay = $('#set-overlay', HTMLInputElement);
  const size = $('#set-size', HTMLSelectElement);
  const side = $('#set-side', HTMLSelectElement);
  sound.checked = initial.sound;
  overlay.checked = initial.overlay;
  size.value = initial.stickSize;
  side.value = initial.moveSide;
  open.onclick = () => {
    panel.hidden = !panel.hidden;
  };
  panel.onsubmit = (e) => {
    e.preventDefault();
    panel.hidden = true;
  };
  const read = (): Settings => ({
    sound: sound.checked,
    overlay: overlay.checked,
    stickSize: size.value === 's' || size.value === 'l' ? size.value : 'm',
    moveSide: side.value === 'right' ? 'right' : 'left',
  });
  panel.onchange = () => {
    const s = read();
    saveSettings(s);
    apply(s);
  };
  apply(initial);
}
