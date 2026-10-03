# ADR-0002 — Shells are fast-forwarded by the shooter's latency; targets are not rewound

- **Status:** accepted
- **Date:** 2026-10-03
- **Applies to:** `sim`, `apps/server`, `netcode`, `apps/web`.

## Context

With ADR-0001 every client sees two times at once: its own tank *now* (predicted) and every other
tank ~100 ms *ago* (interpolated). The press of a trigger lands in the middle of that.

On the shooter's screen, the shell leaves the barrel at the press. On the server, the press arrives
half a round trip later, and the shell — if born then, at the barrel — starts that much behind where
the shooter saw it. At 150 ms of round trip a 600 units/s shell is 45 units behind its own picture:
nearly two tank radii. The shooter watches a shell that the server will later say was somewhere
else.

Shooters solve this one of two ways:

1. **Rewind the targets** (lag compensation, as in Counter-Strike and Overwatch). The server keeps a
   history of positions; when a shot arrives, it moves every other player back to where the shooter
   saw them and tests the hit there. Right for **hitscan** — a bullet that arrives the instant it
   is fired, so "what did the shooter see" is the whole question.
2. **Fast-forward the projectile.** The server spawns the shell where the shooter's prediction drew
   it — moved forward by the shooter's latency — and runs it at the server's present from there.
   Right for **slow, visible projectiles**, which everyone in the room must see fly and dodge.

## Decision

**A shell fired by an input is born on the server at the muzzle and immediately advanced by the
shooter's measured half round trip, capped at `fastForwardMax` ticks (100 ms). From then on it is an
ordinary shell in the server's present. Hits are decided only on the server, against where tanks
are on the server — nothing is rewound.**

- The half round trip is the server's own measurement of the socket (`ping`/`pong`, S3), never a
  number the client sends (invariant 1 of [`docs/protocol.md`](../protocol.md)).
- The fast-forward is steps of the ordinary shell step: a shell fast-forwarded into a wall bounces,
  and one fast-forwarded into a tank hits it — at the server's present.
- The shooter's client draws its own shell at the press (C2) and adopts the real one when the
  snapshot carrying it arrives, matched by the `shot` event's `seq`; the small difference decays
  away like any correction.
- Everyone else sees the shell appear a little way out of the barrel — the fast-forward — which at
  100 ms is 60 units: visible, and honest about the shooter's link.

## Consequences

- **Dodging works.** A shell is where everyone sees it, in the server's present; a target that
  moved out of its path is out of its path. Under rewinding, a player can be hit by a shell that,
  on their own screen, missed them — the classic "shot behind the wall" complaint.
- **The shooter leads where the target was ~100 ms ago.** Interpolation shows them the past; their
  shell flies in the present. A fast tank 100 ms ago is 22 units from where it is: under a tank
  radius. At these speeds, aiming at the picture mostly works; aiming ahead of a moving target is
  part of the game, as it would be on a LAN.
- **The cap is a fairness bound.** Past 100 ms, a laggier player stops gaining: their shells start
  where the server is, not further ahead. A 400 ms player sees their own shells corrected backwards.
  The network lab (C3) lets a stranger see exactly this.
- **No position history on the server**, and no per-shot rewind cost: the server's tick stays a
  tick of the present.

## Alternatives considered

- **Rewinding targets for shells** — fair to the shooter, unfair to everyone being shot at, and
  incoherent for a projectile that flies for 1.6 s through a world that keeps moving.
- **No compensation at all** — the shell starts 45 units behind its picture at 150 ms; the shooter's
  own shell visibly jumps back on every shot.
- **The client chooses where the shell starts** — a client-reported position, which invariant 1
  forbids.
