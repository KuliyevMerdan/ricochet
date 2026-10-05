import type { ConnectionState } from '@ricochet/netcode';
import { validName } from '@ricochet/protocol';
import type { RosterEntry } from '@ricochet/protocol';

/**
 * The DOM over the canvas (CLAUDE.md: text, focus and screen readers for free): the name entry, the
 * connection's state, the scoreboard. It knows the page's elements and nothing of Phaser.
 */

const $ = <T extends HTMLElement>(sel: string, ctor: new () => T): T => {
  const el = document.querySelector(sel);
  if (!(el instanceof ctor)) throw new Error(`the page has no ${sel}`);
  return el;
};

const NAME_KEY = 'ricochet.name';

/** The name form: resolves with a name the rules accept, remembered for the next visit. */
export function askName(message = ''): Promise<string> {
  const form = $('#join', HTMLFormElement);
  const input = $('#name', HTMLInputElement);
  const note = $('#join-note', HTMLElement);
  form.hidden = false;
  note.textContent = message;
  try {
    input.value ||= localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    // Storage refused (a private window): nothing remembered, nothing lost.
  }
  input.focus();
  return new Promise((resolve) => {
    const submit = (e: SubmitEvent) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!validName(name)) {
        note.textContent = '1–16 characters, no control characters.';
        return;
      }
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        // As above.
      }
      form.hidden = true;
      form.removeEventListener('submit', submit);
      resolve(name);
    };
    form.addEventListener('submit', submit);
  });
}

const STATE_TEXT: Record<ConnectionState['kind'], string> = {
  connecting: 'Connecting…',
  joining: 'Joining…',
  live: '',
  reconnecting: 'Reconnecting…',
  outdated: 'A newer version is out.',
  refused: 'That name is taken by the rules.',
  closed: 'Disconnected.',
};

/** The connection's state, shown only when it is not simply live. */
export function showState(s: ConnectionState): void {
  const el = $('#state', HTMLElement);
  const reload = $('#reload', HTMLButtonElement);
  el.textContent = STATE_TEXT[s.kind];
  el.hidden = s.kind === 'live';
  reload.hidden = s.kind !== 'outdated';
  reload.onclick = () => location.reload();
}

/** The room's top five, and the own rank below them when it is not among them. */
export function rank(
  roster: readonly RosterEntry[],
  you: number,
): { top: { place: number; e: RosterEntry }[]; me: { place: number; e: RosterEntry } | null } {
  const sorted = [...roster].sort((a, b) => b.score - a.score || a.id - b.id);
  const placed = sorted.map((e, i) => ({ place: i + 1, e }));
  const top = placed.slice(0, 5);
  const mine = placed.find((p) => p.e.id === you) ?? null;
  return { top, me: mine && mine.place > 5 ? mine : null };
}

let shown = '';

/** The scoreboard, redrawn only when what it shows changed. */
export function showScores(roster: readonly RosterEntry[], you: number): void {
  const { top, me } = rank(roster, you);
  const rows = [...top, ...(me ? [me] : [])];
  const key = rows.map((r) => `${r.place}:${r.e.id}:${r.e.score}:${r.e.name}`).join('|');
  if (key === shown) return;
  shown = key;
  const list = $('#scores', HTMLOListElement);
  list.replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement('li');
      li.value = r.place;
      if (r.e.id === you) li.className = 'me';
      const name = document.createElement('span');
      name.textContent = r.e.bot ? `${r.e.name} ·bot` : r.e.name;
      const score = document.createElement('b');
      score.textContent = String(r.e.score);
      li.append(name, score);
      return li;
    }),
  );
}
