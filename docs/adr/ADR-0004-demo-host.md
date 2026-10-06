# ADR-0004 — The demo host: one origin, one instance, a fresh arena each wake

- **Status:** accepted
- **Date:** 2026-10-06
- **Applies to:** `apps/server` (static serving), the `Dockerfile`, `render.yaml`, the README.

## Context

The live demo has to cost nothing to keep up and need no card: it is a portfolio piece, and a demo
that lapses when a trial ends is worse than none. The three sibling projects run on Render's free
tier, and that tier has two properties that matter here:

1. **It sleeps.** After 15 minutes without inbound traffic the instance stops; the next visitor
   wakes a new one, which takes about a minute.
2. **One instance, no disk.** Nothing survives a stop.

This server keeps nothing worth keeping. A room is a world in memory, stepped at 30 Hz; a player is
a socket and a token; bots fill the seats. There is no money, no history, no account — so the
questions the siblings' ADRs answered about wallets and verification links do not arise. What does
arise is the socket: a WebSocket that a sleeping, restarting or redeploying instance drops.

The alternatives cost more than they buy. A paid always-on instance (~$7 a month and a card) buys a
demo that does not sleep, for a visitor who would otherwise wait a minute once. Several instances
would need rooms shared or pinned across them — a router in front of the socket — for an audience
of one reviewer at a time; 240 players fit in one process with the tick 1 ms late at p99 (P0).

## Decision

**One free instance; every wake is a new arena.** Nothing claims to survive a stop, so nothing
silently fails to.

- **One origin.** `apps/server` serves the built page from `/` (`RICOCHET_STATIC_DIR`) beside the
  socket at `/play` and the probes, so the page needs no CORS, no server address and no proxy — the
  same shape in the Docker image, in the E2E suite and on Render. Hashed assets are cached for a
  year; `index.html` never, so a returning browser runs the client that matches the server — the
  protocol's version byte would refuse one that did not, and the page would offer a reload. A
  directory with no `index.html` refuses to boot.
- **One image.** The `Dockerfile` builds the server and the page's production bundle and ships a
  standalone `pnpm deploy` tree with `NODE_ENV=production`.
- **The lab is on.** `RICOCHET_LAB=on` in `render.yaml`: a visitor can break only their own socket
  (protocol § 3.1, D17), and the demo's point is to watch the netcode cope.
- **Bots fill every room to six**, the production default: a stranger arriving alone has a game.
- **Deploys follow CI.** `autoDeployTrigger: checksPass`: the demo is never a commit that
  `pnpm check`, the E2E suites or the image's own E2E rejected.
- **One region**, Frankfurt. A visitor far from it brings a real round trip of their own to the
  demo; the overlay shows it, and the prediction is what keeps their tank under their thumb anyway.

## Why nothing breaks across a stop

A page open across a sleep or a deploy meets a new instance that has never heard of it, and each
thing it holds already has an honest answer:

- **The socket** closes, or goes silent. The client reconnects either way — at once on a close,
  after 6 s of silence on a link that died without one (P0) — with 250 ms doubling to 4 s between
  tries while the instance wakes.
- **The token** is unknown to the new instance, so the `hello` that carries it joins as a new player
  in a new room (protocol § 3, tested as a token from a room since closed). The page goes on without
  a reload; the scoreboard starts again.
- **The lab's settings** are re-sent after every `welcome`, so a visitor who had added 300 ms still
  has it.

## Consequences

**Good**

- Costs nothing, needs no card, and the image runs unchanged anywhere that runs a container.
- A deploy is a few seconds of `reconnecting` on an open page, not a broken one.

**Bad**

- The first visitor after a quiet quarter of an hour waits about a minute for the page — the page is
  served by the instance it wakes. The README says so.
- Whether an open WebSocket alone keeps the instance awake is Render's to decide, and it is not
  documented in the terms this ADR can rely on; if it does not, a lone player could be put to sleep
  mid-game after 15 minutes. The P1 deploy measures it (CLAUDE.md § Gaps).
