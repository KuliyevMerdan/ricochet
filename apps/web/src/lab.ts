import type { LabFaults, Modes } from '@ricochet/netcode';

/** What the lab panel sets: what the page draws, and how this player's own link behaves. */
export interface LabState {
  readonly ghost: boolean;
  readonly modes: Modes;
  readonly faults: LabFaults;
}

export const LAB_START: LabState = {
  ghost: false,
  modes: { predict: true, interpolate: true },
  faults: { latencyMs: 0, jitterMs: 0 },
};

/** The lab's actions on the link, beyond its settings. */
export interface LabActions {
  apply(s: LabState): void;
  stall(ms: number): void;
  drop(): void;
}

/** The stall the lab's button asks for, ms. */
export const STALL_MS = 2000;

const $ = <T extends HTMLElement>(sel: string, ctor: new () => T): T => {
  const el = document.querySelector(sel);
  if (!(el instanceof ctor)) throw new Error(`the page has no ${sel}`);
  return el;
};

/** A radio group's value as a whole number of milliseconds; anything else is 0. */
export function msOf(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * The network lab (ROADMAP C3): a button opens it, every change applies at once. The ghost, the
 * prediction and the interpolation are the page's; the latency, the jitter, the stall and the drop
 * are this player's own link, made worse on the server's side of the socket (docs/protocol.md
 * § 3.1). Nothing here is remembered: a visit starts on a clean link, the way it really is.
 */
export function labPanel(actions: LabActions, close: () => void): { open(): void } {
  const panel = $('#lab', HTMLFormElement);
  const button = $('#lab-open', HTMLButtonElement);
  const ghost = $('#lab-ghost', HTMLInputElement);
  const predict = $('#lab-predict', HTMLInputElement);
  const interpolate = $('#lab-interpolate', HTMLInputElement);
  const how = $('#how', HTMLElement);
  const read = (): LabState => {
    const pick = (name: string) =>
      msOf(panel.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? null);
    return {
      ghost: ghost.checked,
      modes: { predict: predict.checked, interpolate: interpolate.checked },
      faults: { latencyMs: pick('latency'), jitterMs: pick('jitter') },
    };
  };
  const open = () => {
    close();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  };
  button.onclick = () => {
    if (panel.hidden) open();
    else {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  };
  panel.onsubmit = (e) => {
    e.preventDefault();
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  panel.addEventListener('change', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.id === 'set-overlay') return;
    actions.apply(read());
  });
  $('#lab-stall', HTMLButtonElement).onclick = () => actions.stall(STALL_MS);
  $('#lab-drop', HTMLButtonElement).onclick = () => actions.drop();
  $('#lab-how', HTMLButtonElement).onclick = () => {
    how.hidden = !how.hidden;
  };
  $('#how-close', HTMLButtonElement).onclick = () => {
    how.hidden = true;
  };
  actions.apply(read());
  return { open };
}
