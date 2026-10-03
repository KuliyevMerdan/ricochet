import type { Arena } from '@ricochet/protocol';
import { ARENAS } from '@ricochet/protocol';

/** A tank as the world holds it: what the wire shows, and the timers only the server keeps. */
export interface TankBody {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly hull: number;
  readonly turret: number;
  /** 0 while dead. */
  readonly hp: number;
  readonly alive: boolean;
  /** Ticks until it may fire. */
  readonly reload: number;
  /** Ticks of spawn shield left; it cannot be hurt and cannot fire. */
  readonly shield: number;
  /** Ticks until it respawns; 0 while alive. */
  readonly respawn: number;
  /** Kills since it joined. */
  readonly score: number;
}

/** A shell in flight. */
export interface ShellBody {
  readonly id: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
  readonly bounced: boolean;
  /** Ticks flown. */
  readonly age: number;
}

/**
 * The whole room at one tick. Plain data: integers, booleans and arrays — no class, no reference
 * into anything — so a world compares, serialises and hashes as what it is.
 */
export interface World {
  readonly tick: number;
  readonly arena: number;
  /** The seeded stream (`rng.ts`). */
  readonly rng: number;
  /** In ascending id. */
  readonly tanks: readonly TankBody[];
  /** In ascending id. */
  readonly shells: readonly ShellBody[];
  /** A bit per crate spot. */
  readonly crates: number;
  /** Ticks until the next crate. */
  readonly crateIn: number;
  /** The id the next shell will try. */
  readonly nextShell: number;
}

/**
 * One tank's command for one tick — an input as the server applies it. `seq` is the input's
 * number, carried into the `shot` event; `lead` is how many ticks a shell it fires is
 * fast-forwarded, the server's measure of the shooter's half round trip (ADR-0002).
 */
export interface Command {
  readonly aim: number;
  readonly move: number | null;
  readonly fire: boolean;
  readonly seq?: number;
  readonly lead?: number;
}

export function arenaOf(world: World): Arena {
  const arena = ARENAS[world.arena];
  if (!arena) throw new Error(`no arena ${world.arena}`);
  return arena;
}
