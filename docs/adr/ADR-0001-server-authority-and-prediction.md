# ADR-0001 — The server decides; your tank is predicted, everyone else interpolated

- **Status:** accepted
- **Date:** 2026-10-03 · **amended** 2026-10-05 (C0): a late input stands the tank (protocol D15);
  a prediction stops at another tank where it will be.
- **Applies to:** `sim`, `protocol`, `netcode`, `apps/server`, `apps/web`.

## Context

A player on a phone at 150 ms of round trip presses the stick. Three things can happen next, and
only one is a game:

- **The client moves the tank and tells the server where it is.** Instant, and every tank in the
  room is wherever its client says: through walls, across the map, out of a shell's path after the
  shell has hit. Anything the server would have to believe is a cheat waiting for a client to send
  it.
- **The client tells the server and waits.** Honest, and the tank starts moving 150 ms after the
  thumb — every stop, every turn, every dodge. At 150 ms it feels broken; at 300 it is unplayable.
- **The client tells the server, and moves the tank anyway — by the server's own rules, from the
  server's own last word.** The tank answers on the next frame; the server still decides. When the
  server's word arrives, the client finds out how wrong it was and fixes it.

The third is what every networked action game with a server does. The interesting part is not the
idea; it is making the fix rare and invisible.

## Decision

**The server is the only authority. A client sends inputs and nothing else. The client predicts its
own tank by running the server's own simulation on its own unacknowledged inputs, and draws every
other tank in the recent past, between two snapshots it actually has.**

- **Inputs only.** An input is a direction to drive (or none), a direction to aim and a trigger,
  numbered `seq` 1, 2, 3 … ([`docs/protocol.md`](../protocol.md) § 4.2). The server applies a
  socket's inputs one per tick and sends back, in every snapshot, the last `seq` it applied —
  `ack`.
- **Prediction.** The client keeps every input it sent and the server has not yet acknowledged.
  Each client tick it applies the newest to its own tank with `sim.stepTank` — the function the
  server's `sim.step` calls for every tank. When a snapshot arrives it drops the inputs up to `ack`,
  sets its tank to the server's, and replays the rest. With no other tank involved, the replay *is*
  the server's computation: the same function, the same integer state, the same inputs.
- **Exactness, so a correction means something.** `sim` and `geom` use only operations IEEE 754
  rounds correctly — no `Math.sin`, no `**` — and the world is integers in eighths, the wire's own
  resolution. A browser's prediction and the server's tick therefore agree to the bit, and a
  correction on screen is the server genuinely disagreeing (another tank was in the way, an input
  dropped from a full queue), never two engines rounding differently. Enforced by lint since S0.
  A late input is not a correction: the server invents no input for a tick with none, the tank
  stands (protocol D15), and a tick of standing changes nothing the client predicted.
- **Smoothing.** When a correction moves the tank, the difference between where it was drawn and
  where it now is becomes an offset that decays over ~100 ms. The tank never jumps; it never drifts
  from the truth either, because the truth is what is simulated and only the drawing lags.
- **Interpolation for everyone else.** Remote tanks are drawn at `serverTick − delay`, between the
  two snapshots around that moment. The delay is two snapshot intervals plus the jitter seen, within
  bounds; a snapshot late past it extrapolates one tick at most, then holds. Nothing is drawn from a
  snapshot that does not exist.
- **Hits are never predicted** (C2). Your own shell leaves the barrel at the press; whether it hit
  anything is the server's word, shown when it arrives.

## Consequences

- **The tank answers on the next frame** at any round trip, and the server's word is still final.
  This is the experience the project exists to show.
- **Everyone else is ~100 ms in the past.** You aim at where a tank was. Slow, visible shells make
  this fair enough (ADR-0002); a hitscan weapon would need the server to rewind targets, which this
  game does not.
- **Tank against tank is a guess.** Tanks block and do not push (protocol D12), and your client does
  not know where another tank is *now*. It stops yours where the other will be — where the newest
  snapshot has it, carried on along its last step, one step further for a tank that drives before
  yours in a tick (protocol § 8.1). Decided in C0: with no guess, 44 of 150 contact ticks in a
  ten-minute run were off by up to a tick's drive; with it, 13 of 999 over eight such runs — a tank
  turning or setting off under your nose, which no client can know before the server says.
- **The client carries the simulation.** `netcode` imports `sim`, and the page ships it. That is
  a few kilobytes of integer arithmetic and the reason `sim` must stay pure: a clock or a
  `Math.random` in it would be a correction on every tick.
- **Bandwidth stays small** because inputs are 9 bytes and snapshots are deltas (§ 5 of the
  protocol); bandwidth is not why this is hard.

## Alternatives considered

- **Client authority** — rejected above; it is not a multiplayer game, it is a shared drawing.
- **Lockstep** (every client simulates the whole world from everyone's inputs, as RTS games do) —
  exactness would allow it, but the slowest player's latency becomes everyone's, and a page that
  joins mid-game must replay or be sent the world anyway. Wrong shape for a drop-in .io game.
- **Interpolating your own tank too** (no prediction) — the honest wait above, at 150 ms or more.
