# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project status

> ⚠️ **S0–S3 have landed; nothing on screen yet.** **S0 landed 2026-10-03**: the pnpm + Turborepo
> workspace of ten units, strict TypeScript with no DOM and no Node unless a unit opts in, the
> dependency graph as dependency-cruiser allow-lists, purity and exactness as ESLint rules — all
> *proven to fire* against deliberately illegal fixtures — and CI running `pnpm check`. **S1 landed
> 2026-10-03**: the wire contract and three ADRs; `geom` — the world as integers in eighths, a
> direction table built exactly symmetric, circles swept against walls as exact fractions, 10⁶
> random shots none of which tunnels; `protocol` — a binary codec held to bytes written by hand and
> to the document's tables, snapshots as deltas between views, shells sent once as starting
> conditions. **S2 landed 2026-10-03**: `sim` — the room one tick at a time, pure and exact; 100,000
> random ticks of 12 tanks hold every invariant, and a tank's own inputs replayed through `stepTank`
> reproduce the server's tank in every tick no other tank touched. **S3 landed 2026-10-03**: the
> server — rooms, a drift-free 30 Hz loop, input queues, a snapshot a tick to every player, resume
> tokens, its own measure of every socket's round trip; 12 clients on real sockets for five minutes,
> every tick within 1.77 ms of its deadline at p99 and every client holding exactly the view it was
> sent. **S4** (bots and the bench) is next.
>
> The canon is four documents: `CLAUDE.md` (this file), [`ROADMAP.md`](ROADMAP.md) (the task map),
> [`docs/protocol.md`](docs/protocol.md) (the wire contract) and [`docs/adr/`](docs/adr) (the
> decisions everything else is downstream of).
>
> Below **Project description**, a section written in the present tense describes code that exists;
> one that names a block (`S1`, `C0`…) describes the shape the code **must take** when that block
> lands.
>
> **This distinction is load-bearing.** When you implement a block, rewrite its section here in the
> present tense in the same change ([Rule 0](#rule-0--keep-this-file-updated-after-every-change)) —
> and if reality diverged from the plan, the plan is what's wrong.

**This repository is standalone.** It shares no code with `../slots`, `../crash` or `../blackjack`
and must not grow a dependency on any of them — not a package, not a path alias, not a copied
`tsconfig` that references one. Decisions repeat between the projects; modules do not.

## Project description

> ⚠️ **Keep this section current.** See [Rule 0](#rule-0--keep-this-file-updated-after-every-change).

A **real-time multiplayer tank arena in the browser, .io style**. Open the link, type a name,
drive: top-down and twin-stick — the hull goes where you steer, the turret where you aim — and
every shell bounces off a wall once. Up to 12 tanks a room, bots filling it to 6. Node + TypeScript
server, Phaser client, one WebSocket carrying a binary protocol. The game's numbers are in
[`docs/protocol.md`](docs/protocol.md) § 8 Rules, and in code as `protocol.RULES`.

**Target role:** HTML5 game client developer on a multiplayer title. This is the fourth portfolio
project and the first outside iGaming, and it exists for the axis the other three do not cover:
**every player steers, and every input fights the latency**. The slot presents one committed
outcome, the crash game synchronises one shared clock, blackjack holds a tree of decisions through
lost replies; here the client must answer the thumb on the next frame while the server, 150 ms
away, stays the only authority.

No money of any kind — this is not a casino game.

### The decisions everything hangs on

1. **The server is the only authority**
   ([ADR-0001](docs/adr/ADR-0001-server-authority-and-prediction.md)). It steps one world at 30 Hz from everyone's
   inputs and sends each client a snapshot of what that client may see. A client sends inputs — a
   direction, an aim, buttons — never a position.
2. **Your own tank is predicted** (ADR-0001). The client runs the same `sim` on its own inputs at
   once, keeps those the server has not acknowledged, and on every snapshot rewinds to the server's
   tank and replays them. A visible correction is smoothed away as a decaying offset, never snapped.
3. **Everyone else is interpolated** ~100 ms in the past, between two snapshots that both exist. The
   delay adapts to the link's jitter.
4. **Shells are fast-forwarded, not targets rewound**
   ([ADR-0002](docs/adr/ADR-0002-shells-fast-forwarded.md)). A shell fired by your input starts
   on the server moved forward by your half round trip, capped at 100 ms — where your prediction
   drew it. Hits are decided only on the server, at its own present.
5. **The wire is bytes** ([ADR-0003](docs/adr/ADR-0003-websocket.md) for a WebSocket, and what TCP
   lets the protocol drop). The world is integers — eighths of a unit, 1/1,024ths of a turn — so the
   wire carries it at its own resolution; snapshots are deltas against the last one sent on the
   socket; a shell is sent once, as a starting condition the client flies on with `sim`; and each
   client is sent only what lies within its view ([`docs/protocol.md`](docs/protocol.md)).

### The invariant that makes prediction exact

**`sim` computes the same bits in every engine.** The server's Node and the player's browser run
`sim.stepTank` on the same inputs from the same quantised state; if they disagree by one ulp, the
player sees a correction that no latency caused. So `sim` and `geom` use only operations IEEE 754
rounds correctly — `+ - * /` and `Math.sqrt` — and a direction is a lookup in `geom`'s committed
table of 1,024, never `Math.sin`. The world is quantised to the wire's precision at the end of every
tick, so a client replaying from a snapshot runs the server's own computation, not an approximation
of it. Enforced by lint since S0 (§ Purity and exactness).

### Packages

All ten exist since **S0**; four are written. The right-hand column is the block that fills each.

| Package | Responsibility | Block |
| --- | --- | --- |
| `packages/geom` | the world's grid — integers in **eighths** of a unit (`ARENA_EIGHTHS`, `eighths`, `roundHalfAway`); the 1,024-direction table (`COS`, `SIN`, ×2^14), printed by [`golden/directions.py`](packages/geom/golden/directions.py) from one octant and its symmetries, so `reflect` off a face is exact on the index *and* the vector; `step(d, speed)`, `turnToward`, and `nearestDir` — a mouse offset to a direction by cross products, no `atan2`; `circleOverlapsBox` by squared distances; `sweep` — a moving circle against a box grown by its radius, every time a fraction of integers and every comparison a cross-multiplication, returning the first contact and the face it met. Pure and exact | ✅ S1 |
| `packages/protocol` | the binary wire ([`docs/protocol.md`](docs/protocol.md)): `encodeClient` / `decodeClient`, `encodeServer` / `decodeServer` over `DataView`, little-endian — a read past the end sets a flag instead of throwing, and a frame is refused as a value for truncation, trailing bytes, a reserved bit or a field out of range; `diff(base, next)` and `apply(base, snapshot)` between per-client **views** — tanks by field mask with small `i8` steps, shells once as starting conditions — `apply` refusing a delta not of its base; strict hand-written UTF-8 and `validName`; `RULES`, the game's numbers, here because the bots play by them. Pure | ✅ S1 |
| `packages/sim` | the room, one tick at a time: `step(world, commands) → { world, events }` — timers and respawn, driving, firing, flight, crates, in that order ([`docs/protocol.md`](docs/protocol.md) § 8.1); `createWorld`, `join`, `leave`. `stepTank(tank, command, arena, obstacles)` — **the prediction's entry point**, the hull turning or reversing toward the stick and the move taken along x then y as far as it is free; `stepShell` — a shell's flight with no tanks, what a client runs on the shells it holds; `fly` / `flyTick` with tanks, sparing the owner until the bounce. `view(world, viewer, events, ack)` — **the one door to the wire**: a square of `viewHalf`, the viewer's timers, events filtered by § 6. A world is plain data — integers, booleans, arrays — and its randomness a mulberry32 state inside it. Returns events; never emits. Pure and exact | ✅ S2 |
| `packages/bots` | `decide(snapshot, memory) → input` — a path round the walls, aim with lead and a deliberate error, a bank shot when the straight line is blocked. Sees only a snapshot, acts only by inputs. Pure | S4 |
| `packages/netcode` | the socket, the handshake, the clock; prediction and reconciliation through `sim.stepTank`; the adaptive interpolation buffer; `frame(now)` — positions for the renderer between ticks. **No DOM**: the socket, timers and clock are handed in, so the browser, the load tool and the tests run the same code | C0 |
| `packages/renderer` | the arena in Phaser: textures generated at boot, hull and turret, shells, crates, walls, the camera with a lead toward the aim, the minimap, pooled particles. **No protocol** — it draws pictures | C1 |
| `apps/server` | Fastify for `/health` and `/ready` (the tick's lateness and work at p99 among its numbers); `ws` for the game at `/play`. `Ticker` — one drift-free 30 Hz loop for every room, deadlines from the first tick, sleeping to just short of each and spinning the rest on `setImmediate`. `Room` — a world, its players' input queues (one a tick in `seq` order; a late input holds the stick, not the trigger), a snapshot a tick to each player diffed against the last sent on its socket, the roster, the resume grace, the fast-forward `lead` from the socket's round trip. `Lobby` — the fullest room with a seat, `FULL` past the limit, tokens, idle rooms closed. `Connection` — one socket's protocol: `hello` first, refusals as `VERSION` / `NAME` / `MALFORMED` / `RATE`, `pong`s. `sockets.ts` — the `ws` wiring and the WebSocket-level pings that measure each socket's round trip. `Room`, `Lobby` and `Connection` know no socket | ✅ S3 |
| `apps/web` | Vite, one Phaser game, a DOM layer (name, connection state, scoreboard, overlay); three input schemes; own shells predicted; the server ghost, the overlay, the network lab, the kill replay | C1 · C2 · C3 |
| `tools/bench` | rooms of bots stepped headless as fast as they go — the tick's cost and the bytes per client, full and delta, to `docs/bench/` | S4 |
| `tools/load` | headless clients through `netcode`, played by `bots`, over the wire against a running server — tick, bandwidth, corrections, reconnects, to `docs/load/` | P0 |

**Phaser draws; `sim` decides.** Phaser 4 (the stable major at S0) is the studio-standard engine for
HTML5 games and brings the scene, input, cameras, particles and sound. Its physics is **not used**:
a world stepped by Phaser on the client and by something else on the server could never be
predicted. The name field, the scoreboard and the overlay are **DOM** over the canvas — text,
focus and screen readers for free. No React: the shell is too small for a framework to earn its
place.

### Dependency rules — enforced, not suggested

Enforced by `dependency-cruiser` ([`.dependency-cruiser.cjs`](.dependency-cruiser.cjs)) in
`pnpm lint:boundaries`, which `pnpm lint` and CI run — not by discipline. Each unit has an allow-list
matching this graph exactly; anything else in the workspace is an error.

```
geom ──▶ (nothing)
protocol ──▶ geom
sim ──▶ protocol, geom
bots ──▶ protocol, geom
netcode ──▶ sim, protocol, geom
renderer ──▶ geom
apps/server ──▶ sim, bots, protocol, geom
apps/web ──▶ netcode, renderer, protocol, geom
tools/bench ──▶ sim, bots, protocol, geom
tools/load ──▶ netcode, bots, protocol, geom
```

Hard rules on top of the graph:

- **`bots` may not import `sim`** (`bots-deps`). A bot sees exactly the snapshot a player is sent
  and acts only through inputs — it cannot see through a wall or move faster than a tank, by
  construction rather than by care.
- **`renderer` may not import `protocol`** (`renderer-deps`). It draws pictures; it does not know
  what a snapshot is. The arena can be tested without a server and re-skinned without touching
  the game.
- **`apps/web` reaches `sim` only through `netcode`** (`web-deps`). The page predicts its own tank;
  it never steps a world of its own.
- **Phaser stays on the stage** (`phaser-stays-on-stage`): `renderer` and `apps/web` only.
- **The load tool plays over the wire** (`load-deps`): `netcode`, never `sim`.
- **No React anywhere** (`no-react`).
- **Nothing imports `apps/*`** (`nothing-imports-apps`).
- **No unit may import from `../slots`, `../crash` or `../blackjack`** (`no-siblings`) — by relative
  path or by `@slot/*` / `@crash/*` / `@blackjack/*` name.
- **No package imports a Node builtin** (`packages-no-node-builtins`) **or a server library** —
  `fastify`, `ws`, `pino` (`packages-no-server-libs`). Node belongs to `apps/server` and `tools/*`;
  `netcode` is handed its socket.
- **A unit is reached through its entry point**, never its `src/` (`no-cross-package-deep-imports`).

**The rules are proven, not trusted.** `lint:boundaries` finding nothing in the real workspace says
nothing about whether a rule works, so [`config/fixtures/`](config/fixtures) holds deliberately
illegal imports and `tests/boundaries.test.ts` asserts each is rejected **by name** — and that the
legal allow-lists are not. A workspace import resolves to the target's `dist/`, and the config *does
not follow* `dist` rather than excluding it: excluding it would delete the edge, and an illegal
import would go quiet the moment its dependency was declared (verified against the real workspace at
S0: `bots → sim` and `renderer → protocol`, both declared and built, are still errors).

### Purity and exactness

Enforced by ESLint ([`eslint.config.mjs`](eslint.config.mjs)) and proven by `tests/purity.test.ts`,
which lints one fixture per package — a package dropped from a list is the likeliest way for a rule
to stop applying.

**Pure — `geom`, `protocol`, `sim`, `bots`** (`PURE_PACKAGES`):

- No `Date.now()`, `new Date()`, `performance.now()`. **Time is a parameter** — the tick is handed
  in.
- No `Math.random()`. Randomness enters as a seed carried in the world.
- No I/O, no globals, no ambient config — `fetch`, `window`, `document`, `localStorage`, `process`
  are lint errors.

**Exact — `geom`, `sim`** (`EXACT_PACKAGES`): no `Math.sin`, `cos`, `tan`, their inverses and
hyperbolics, `atan2`, `exp`, `log`, `pow`, `cbrt`, `hypot`, and no `**` — ECMAScript leaves them
*implementation-approximated*, and V8, JavaScriptCore and SpiderMonkey may each round the last bit
differently. `Math.sqrt`, `min`, `max`, `abs`, `floor` and the four operators are exact everywhere
and stay legal; the fixture proves both halves. `protocol` is pure but not held to exactness: a
codec moves bits and computes no position.

The compiler holds the same line: the base tsconfig has **no DOM lib and no Node types**, so a pure
package — and `netcode`, which must run in the browser, in Node and in a test — cannot name
`document` or `Buffer` without failing to build. `renderer` and `apps/web` opt into the DOM
(`config/tsconfig-dom.json`); `apps/server` and `tools/*` into Node (`config/tsconfig-node.json`).

### Testing layers

| Layer | What it proves | Block |
| --- | --- | --- |
| Rules | every dependency rule rejects its illegal fixture by name and accepts the legal allow-lists; purity in all four pure packages; exactness in `geom` and `sim` and not in `protocol`; the `any` / `!` / `as` bans — 57 root tests | ✅ S0 |
| Golden | every message written by hand beside its bytes, also written by hand from the document — both directions held to them, every truncation and a trailing byte refused, no client frame taken for a server one; 26 frames one field from valid, each refused with its reason; the direction table rerun from its script (`tests/golden-fresh.test.ts`); the document's message, event, error and rules tables held to the code (`tests/protocol-doc.test.ts`) | ✅ S1 |
| Geometry | the table exactly symmetric, on the unit circle within rounding, turning steadily; a mirrored direction's step the mirrored step at every speed to 320; 10⁶ random shots, radii to 8 units, speeds to twice a shell's, walls from 16 units thick — each sweep meeting the wall on its grown boundary, no later than a 64-point sampling of the move | ✅ S1 |
| Codec | 100,000 random messages each way decode to themselves; 20,000 ticks of a moving world through `diff`, the bytes and `apply` arrive as the server's view, under 200 bytes a tick | ✅ S1 |
| World | every rule on staged worlds (23); arena 0's edges, walls apart, spawns and crates clear and reachable; 100,000 random ticks of 12 tanks with players coming and going — no tank in a wall or another tank, no shell in a wall or off the arena, hit points and scores what the events say, every tenth tick every view across the wire; 0 mismatches in 200,000 ticks of `stepTank` replays where no other tank came near; the same seed the same world, and 5,000 ticks pinned to a hash | ✅ S2 |
| Server | the ticker against a hand-moved clock — deadlines from the first tick under 7 ms of work a tick, a stall caught up, a pause rebased; a room's queues, acks, the held stick, the fast-forward, the grace, the roster; the lobby's filling, `FULL`, resume and expiry; a connection's refusals and pongs · 12 clients on real sockets (`server.test.ts`, ten seconds in CI, `soak` five minutes): every client's view the server's at every tick, every view the world as it stands, tick lateness p99 under 2 ms | ✅ S3 |
| Netcode | a headless client at 150 ± 40 ms for 10 minutes against the real `sim`: prediction equal to the server's after every reconciliation where no other tank touched it | C0 |
| Browser | 60 fps at 12 tanks and 36 shells on a throttled phone profile, flat memory, an idle hidden tab drawing nothing; no predicted shell shown hitting a tank the server says it missed | C1 · C2 |
| Load | 240 clients for 30 minutes — every tick on time at p99, under the bandwidth budget, every resume finding its tank | P0 |
| E2E | Playwright: two browsers in one room see each other, one kills the other, the lab's latency, a resumed socket | P1 |

## Commands

Everything runs from the repo root on Node ≥ 20.19 (CI uses 22) and pnpm 10. The one command before
every commit:

```bash
pnpm check
```

| Command | What it does |
| --- | --- |
| `pnpm check` | lint → build → typecheck → unit tests → root suites → format check. **What CI runs.** |
| `pnpm lint` | ESLint (purity, exactness, type-safety) and `lint:boundaries` |
| `pnpm lint:boundaries` | dependency-cruiser over `packages/`, `apps/`, `tools/` |
| `pnpm build` | `tsc` to `dist/` per unit, in dependency order (Turborepo) |
| `pnpm typecheck` | the root suites' tsconfig, then every unit's |
| `pnpm test` | each unit's own `src/**/*.test.ts` (`config/vitest.package.ts`) |
| `pnpm test:root` | `tests/` — the rules proven against `config/fixtures/`, the direction table held to its generator (needs `python3`, standard library only), and the protocol document held to the code |
| `pnpm format` | Prettier. Markdown is excluded: the canon is hand-wrapped |

The server on its own: `pnpm --filter @ricochet/server dev` (tsx watch, port 8080; `PORT`,
`HOST`, `RICOCHET_MAX_ROOMS`, `RICOCHET_PING_MS`, `LOG_LEVEL`). `pnpm --filter @ricochet/server
soak` is S3's five-minute done-when (`RICOCHET_SOAK_S` for another length).

Units resolve each other through their built `dist/` and package `exports`, ordered by Turborepo's
`^build` — not through TypeScript project references, which would duplicate what Turborepo already
orders. `build` therefore runs before `typecheck` and the tests.

A pre-commit hook (husky → lint-staged) runs ESLint and Prettier over staged files. `turbo.json`
sets `agentGuidance: false`: Turborepo ≥ 2.11 otherwise writes an `AGENTS.md` whenever it detects an
AI agent, and this file is where the repository's guidance lives.

## Gaps & missing pieces

Log what you hit here as you hit it ([Rule 1](#rule-1--log-the-gaps-you-hit)). Open at time of
writing — the questions [`ROADMAP.md`](ROADMAP.md) leaves to a block:

- **Snapshot rate.** 30 Hz is the plan; whether 15 Hz with a longer interpolation delay looks the
  same at half the bytes is measured, not argued. S4 measures the bytes, C1 decides the look.
- **Cross-engine determinism, shown.** `sim` is exact by construction and lint, and the soak pins a
  5,000-tick run to a hash — but only in V8. C1 replays that run in Chromium, Firefox and WebKit
  (Playwright) and requires the same hash; until then "the same in every engine" is argued, not
  measured.
- **Tank against tank.** The plan does not predict pushing: the own tank stops at another where the
  server says, and the correction is the visible cost. C0 confirms or changes it.
- **Gamepad on iOS Safari.** Supported, or said not to be. C2.
- **Toolchain majors held back.** TypeScript 7, Vitest 5, ESLint 10 and dependency-cruiser 18 were
  out at S0; the workspace pins the majors the three sibling projects run on (TypeScript 5,
  Vitest 3, ESLint 9, dependency-cruiser 16), so a break is never two problems at once. Move them
  together, in a change of their own, when a block needs something newer.

## Rules

### Rule 0 — Keep this file updated after every change

When a block lands, rewrite its sections here in the **present tense** in the **same change**, and
tick it off in [`ROADMAP.md`](ROADMAP.md). A section describing an intent the code no longer has is
worse than no section: the next reader trusts it.

If the code diverged from the plan, the plan is what's wrong. Fix the document, and if the
divergence touched a pinned decision, write or amend an ADR.

### Rule 1 — Log the gaps you hit

When you hit something the canon doesn't answer, add it to **Gaps & missing pieces** with the block
that should close it — then keep working. Delete the entry in the change that fills it. The list is
a work queue, not an archive.

### Other rules

- **A test that loops over thousands of ticks carries its own timeout** (`it(…, 60_000)`), and
  asserts once at the end rather than per iteration. Vitest's 5 s default holds on a laptop and not
  on a CI runner shared with every other suite — the sibling projects learned it twice.
- **The protocol document and `packages/protocol` change together**, in one commit, always.
- **No `any`, no non-null `!`, no `as` outside a parser boundary.** `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; the bans are lint errors in every unit's
  source, proven by a fixture. `as const` stays legal.
- **Every inbound frame is decoded at the boundary, on both sides**, and a malformed one is a value,
  not a throw. The server does not trust the client; the client does not trust the server either —
  a mismatch is deploy skew, worth failing loudly on.
- **A client never sends a position, a hit or a score** — only inputs. Anything the server would
  have to believe is a cheat waiting for a client to send it.
- **Nothing outside a client's view is sent to it** — not in a snapshot, an event, a debug panel or
  the network lab. A wallhack is a leak with no recovery.
