import { SKILLS, createBot, decide } from '@ricochet/bots';
import type { Memory, Skill } from '@ricochet/bots';
import type { Intent, LabFaults } from '@ricochet/netcode';
import type { Arena, View } from '@ricochet/protocol';

/**
 * A load client's thumb: `bots`' policy, handed the view the client holds — the same snapshots a
 * person's page draws from — and answering with the intent a page would sample. A new tank (a
 * rejoin after the grace ran out) gets a new memory; with no view yet, the tank stands.
 */
export class BotDriver {
  private memory: Memory | null = null;

  constructor(
    private readonly arena: Arena,
    private readonly seed: number,
    private readonly skill: Skill = SKILLS.normal,
  ) {}

  intent(view: View | null, you: number): Intent {
    if (!view || you === 0) return { aim: 0, move: null, fire: false };
    if (this.memory?.id !== you) this.memory = createBot(you, this.arena, this.seed, this.skill);
    const r = decide(view, this.memory);
    this.memory = r.memory;
    return r.input;
  }
}

/**
 * How a load client's link misbehaves — through the server's own network lab (docs/protocol.md
 * § 3.1), so the faults are the ones a visitor can put on themselves, on the server's side of the
 * socket.
 */
export interface Profile {
  readonly name: 'clean' | 'lagged' | 'rough' | 'dropper';
  readonly faults: LabFaults;
  /** A stall this long, ms, every `stallEveryMs`; `null` for none. */
  readonly stall: { readonly ms: number; readonly everyMs: number } | null;
  /** The socket dropped every `everyMs` — every `longEvery`-th time for `outageMs` with no way
   * back, past the resume grace, so the client must rejoin as new. */
  readonly drop: {
    readonly everyMs: number;
    readonly longEvery: number;
    readonly outageMs: number;
  } | null;
}

export const PROFILES: Readonly<Record<Profile['name'], Profile>> = {
  clean: { name: 'clean', faults: { latencyMs: 0, jitterMs: 0 }, stall: null, drop: null },
  lagged: { name: 'lagged', faults: { latencyMs: 150, jitterMs: 40 }, stall: null, drop: null },
  rough: {
    name: 'rough',
    faults: { latencyMs: 300, jitterMs: 100 },
    stall: { ms: 2000, everyMs: 90_000 },
    drop: null,
  },
  dropper: {
    name: 'dropper',
    faults: { latencyMs: 100, jitterMs: 20 },
    stall: null,
    drop: { everyMs: 120_000, longEvery: 3, outageMs: 13_000 },
  },
};

/** A room of twelve: half on a clean link, the rest on the lab's — lagged, rough, dropping. */
export const ROOM_MIX: readonly Profile['name'][] = [
  'clean',
  'clean',
  'clean',
  'clean',
  'clean',
  'clean',
  'lagged',
  'lagged',
  'lagged',
  'rough',
  'dropper',
  'dropper',
];
