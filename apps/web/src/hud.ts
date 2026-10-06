import type { Client } from '@ricochet/netcode';
import { RULES } from '@ricochet/protocol';
import type { GameEvent, RosterEntry, View } from '@ricochet/protocol';
import { History, SAMPLE_HZ, drawGraph } from './graph.js';
import type { KillReplay } from './replay.js';
import type { Settings } from './settings.js';
import { saveSettings } from './settings.js';

/**
 * The DOM over the arena: the kill feed, the death screen — who did it and the count to the
 * respawn — and the kill replay it starts (C3), the settings, and the network overlay: the round
 * trip and its jitter, the interpolation delay and the buffer's depth, the inputs unacknowledged,
 * the corrections a second and their size, the bytes each way, the tick, and a graph of the last
 * ten seconds (C3). Names are the roster's, set as text: a name is never markup.
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
  private readonly overlay = $('#overlay', HTMLDivElement);
  private readonly overlayText = $('#overlay-text', HTMLPreElement);
  private readonly graph = $('#overlay-graph', HTMLCanvasElement);
  private readonly history = new History();
  private lastSample = { at: 0, corrected: 0 };
  private lastFixes = { corrections: 0, corrected: 0 };
  private fixRate = 0;
  private fixSize = 0;
  /** Who killed the own tank last, while it is dead. */
  private killer: number | null = null;
  private lastFrames = 0;
  private lastAt = 0;
  private fps = 0;
  private lastBytes = { in: 0, out: 0, at: 0 };
  private rate = { in: 0, out: 0 };

  constructor(
    private readonly client: Client,
    private readonly replay: KillReplay,
  ) {
    client.onEvents((events) => this.events(events));
  }

  private events(events: readonly GameEvent[]): void {
    for (const e of events) {
      if (e.type !== 'kill') continue;
      if (e.victim === this.client.you) {
        this.killer = e.killer;
        // The newest view held is the death's: the replay is the three seconds up to it.
        const r = this.client.replay();
        if (r) this.replay.play(r, nameOf(this.client.roster, e.killer));
      }
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
      if (this.replay.playing && this.replay.done(now)) this.replay.stop();
    }

    this.overlay.hidden = !settings.overlay;
    if (now - this.lastSample.at >= 1000 / SAMPLE_HZ) {
      const st = this.client.stats();
      this.history.push({
        rttMs: st.rttMs,
        delayMs: st.delayMs,
        bufferMs: st.bufferMs,
        fixUnits: Math.max(0, st.corrected - this.lastSample.corrected) / 8,
      });
      this.lastSample = { at: now, corrected: st.corrected };
      if (settings.overlay) drawGraph(this.graph, this.history);
    }
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
      if (this.lastAt) {
        const n = st.corrections - this.lastFixes.corrections;
        this.fixRate = n / dt;
        this.fixSize = n > 0 ? (st.corrected - this.lastFixes.corrected) / n / 8 : 0;
      }
      this.lastFixes = { corrections: st.corrections, corrected: st.corrected };
      this.lastFrames = frames;
      this.lastAt = now;
      if (settings.overlay) {
        const s = st.shots;
        const modes = this.client.modes;
        const faults = this.client.labFaults;
        this.overlayText.textContent = [
          `rtt      ${st.rttMs === null ? '—' : `${Math.round(st.rttMs)} ms`} · jitter ${Math.round(st.jitterMs)} ms`,
          `interp   ${modes.interpolate ? `${Math.round(st.delayMs)} ms behind` : 'off'} · ${Math.round(st.bufferMs)} ms held`,
          `predict  ${modes.predict ? `${st.unacked} inputs ahead, lead ${st.lead}` : 'off'}`,
          `fixes    ${this.fixRate.toFixed(1)}/s · ${this.fixSize.toFixed(1)} u each`,
          `shots    ${s.predicted} → ${s.adopted} adopted, ${s.fizzled} fizzled`,
          `in/out   ${this.rate.in.toFixed(1)} / ${this.rate.out.toFixed(1)} KB/s`,
          `tick     ${st.tick ?? '—'} · ${Math.round(this.fps)} fps`,
          ...(faults.latencyMs || faults.jitterMs
            ? [`lab      +${faults.latencyMs} ms ± ${faults.jitterMs} ms`]
            : []),
        ].join('\n');
      }
    }
  }
}

/** The settings panel: a button opens it; every change applies at once and is remembered. The
 * overlay's box sits in the lab's panel and is remembered here. Returns how to close it. */
export function settingsPanel(
  initial: Settings,
  apply: (s: Settings) => void,
  opening: () => void,
): { close(): void } {
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
    if (panel.hidden) opening();
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
  overlay.onchange = panel.onchange;
  apply(initial);
  return {
    close: () => {
      panel.hidden = true;
    },
  };
}
