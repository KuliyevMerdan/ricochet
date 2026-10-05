import { createClient } from '@ricochet/netcode';
import type { Client, Frame } from '@ricochet/netcode';
import { ARENA_0, RULES } from '@ricochet/protocol';
import { mountArena } from '@ricochet/renderer';
import type { ArenaView, Picture } from '@ricochet/renderer';
import { KeyboardMouse } from './controls.js';
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

const stage = document.getElementById('stage');
if (!stage) throw new Error('the page has no #stage');
const arena = { size: RULES.arena, walls: ARENA_0.walls, crates: ARENA_0.crates };

/** Hooks for the perf script and the console; not part of any interface. */
const hooks: { view?: ArenaView; client?: Client } = {};
Object.assign(window, { __ricochet: hooks });

if (new URLSearchParams(location.search).has('stress')) {
  hooks.view = mountArena({ parent: stage, arena, picture: stress(RULES.arena) });
} else {
  void play(await askName());
}

async function play(name: string): Promise<void> {
  let view: ArenaView | null = null;
  const controls = new KeyboardMouse(stage ?? document.body, () => view?.pointerFromMe() ?? null);
  const client = createClient({
    connect: browserSocket(playUrl(location)),
    clock: browserClock,
    timers: browserTimers,
    name,
    intent: () => controls.intent(),
  });
  hooks.client = client;

  const picture: Mutable<Picture> = { me: null, others: [], shells: [], crates: 0, aim: null };
  const draw = (now: number): Picture => {
    const f: Frame = client.frame(now);
    picture.me = f.me;
    picture.others = f.others;
    picture.shells = f.shells;
    picture.crates = f.crates;
    picture.aim = f.me ? controls.lastAim : null;
    return picture;
  };
  view = mountArena({ parent: stage ?? document.body, arena, picture: draw });
  hooks.view = view;

  let you = 0;
  client.onState((s) => {
    showState(s);
    if (s.kind === 'live') you = s.you;
    if (s.kind === 'refused') {
      view?.destroy();
      void askName('The server refused that name. Try another.').then(play);
    }
  });
  showState(client.state);
  setInterval(() => showScores(client.roster, you), 250);
}
