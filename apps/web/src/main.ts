import { createClient } from '@ricochet/netcode';
import type { Client, Frame } from '@ricochet/netcode';
import { ARENA_0, RULES } from '@ricochet/protocol';
import { mountArena } from '@ricochet/renderer';
import type { ArenaView, Picture } from '@ricochet/renderer';
import { Hud, settingsPanel } from './hud.js';
import { Controls } from './input/controls.js';
import { loadSettings } from './settings.js';
import type { Settings } from './settings.js';
import { browserClock, browserSocket, browserTimers, playUrl } from './socket.js';
import { stress } from './stress.js';
import './style.css';
import { askName, showScores, showState } from './ui.js';

/**
 * The page: a name, then one Phaser game drawing what `netcode` says, and the DOM over it. Phaser
 * draws at the display's rate from `client.frame(now)` — the ticks never drive frames (ROADMAP C1).
 * `?stress` draws C1's worst case without a server, for `scripts/perf.mjs`.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`the page has no #${id}`);
  return el;
};
const stage = $('stage');
const arena = { size: RULES.arena, walls: ARENA_0.walls, crates: ARENA_0.crates };

/** Hooks for the measurement scripts and the console; not part of any interface. */
const hooks: {
  view?: ArenaView;
  client?: Client;
  picture?: Picture;
  effects?: Picture['effects'][];
} = {};
Object.assign(window, { __ricochet: hooks });

if (new URLSearchParams(location.search).has('stress')) {
  hooks.view = mountArena({ parent: stage, arena, picture: stress(RULES.arena) });
} else {
  void play(await askName());
}

async function play(name: string): Promise<void> {
  let view: ArenaView | null = null;
  let settings: Settings = loadSettings();
  const controls = new Controls(stage, $('sticks'), () => view?.pointerFromMe() ?? null);
  const client = createClient({
    connect: browserSocket(playUrl(location)),
    clock: browserClock,
    timers: browserTimers,
    name,
    intent: () => controls.intent(),
    peek: () => controls.peek(),
  });
  hooks.client = client;
  const hud = new Hud(client);

  const picture: Mutable<Picture> = {
    me: null,
    others: [],
    shells: [],
    crates: 0,
    effects: [],
    aim: null,
  };
  const draw = (now: number): Picture => {
    const f: Frame = client.frame(now);
    picture.me = f.me;
    picture.others = f.others;
    picture.shells = f.shells;
    picture.crates = f.crates;
    picture.effects = f.effects;
    picture.aim = f.me ? f.me.turret : null;
    hooks.picture = picture;
    if (f.effects.length > 0) hooks.effects?.push(f.effects);
    hud.update(now, client.latest, view?.stats().frames ?? 0, settings);
    return picture;
  };
  view = mountArena({ parent: stage, arena, picture: draw });
  hooks.view = view;

  settingsPanel(settings, (s) => {
    settings = s;
    view?.setMuted(!s.sound);
    controls.configure(s.stickSize, s.moveSide);
  });

  client.onState((s) => {
    showState(s);
    if (s.kind === 'refused') {
      view?.destroy();
      void askName('The server refused that name. Try another.').then(play);
    }
  });
  showState(client.state);
  setInterval(() => showScores(client.roster, client.you), 250);
}
