import { ARENA_EIGHTHS } from '@ricochet/geom';

/**
 * The game's numbers — docs/protocol.md § 8, and nowhere else. Lengths are in eighths of a unit,
 * speeds in eighths per tick, times in ticks, turns in directions (1,024 to the turn). They live in
 * the contract rather than in `sim` because the bots, which may not import `sim`, play by them too.
 */
export const RULES = {
  /** Ticks per second; one snapshot to every client per tick. */
  tickHz: 30,
  /** The arena's side. */
  arena: ARENA_EIGHTHS,
  /**
   * A client is sent what lies within this many eighths of its tank on each axis — a square 1,760
   * units across: the camera's 1,280 units, its 80-unit lead toward the aim on either side, and 160
   * units of margin for what crosses into view during the interpolation delay (§ 5).
   */
  viewHalf: 7040,

  /** 24 units. */
  tankRadius: 192,
  /** 221.25 units a second, along the hull. */
  tankSpeed: 59,
  /** ≈253° a second. */
  hullTurn: 24,
  hitPoints: 3,

  /** 6 units. */
  shellRadius: 48,
  /** 600 units a second. */
  shellSpeed: 160,
  /** 1.6 s. */
  shellLife: 48,
  /** A shell dies on its second wall. */
  shellBounces: 1,
  /** A shell is born this far from its tank's centre, along the turret: 32 units. */
  muzzle: 256,
  /** ≈367 ms between shots. */
  reload: 11,
  /** A tank's shells in the air at once. */
  maxShells: 3,

  /** 3 s from death to respawn. */
  respawn: 90,
  /** 1.5 s of shield after a respawn, in which the tank cannot fire. */
  shield: 45,

  /** A crate appears every 20 s at a free spot. */
  crateEvery: 600,
  crateSpots: 4,
  /** 16 units. */
  crateRadius: 128,
  crateHeal: 1,

  /** People and bots in a room. */
  roomSize: 12,
  /** Bots fill a room to this many tanks and leave as people arrive. */
  botsFillTo: 6,
  /** A dropped socket keeps its tank this long: 10 s. */
  resumeGrace: 300,
  /** The most a shell is fast-forwarded by its shooter's half round trip (ADR-0002): 100 ms. */
  fastForwardMax: 3,
  /** Inputs a player may have queued; beyond it the oldest is dropped. */
  inputQueueMax: 4,
} as const;
