# Ricochet — Roadmap

Drafted **2026-10-03**. A **real-time multiplayer tank arena in the browser, .io style** — open the
link, type a name, drive. Top-down, twin-stick: the hull goes where you steer, the turret where you
aim, and every shell bounces off a wall once. Node + TypeScript server, Phaser client, one WebSocket
carrying a binary protocol. Fourth portfolio project and the first outside iGaming, standalone,
sharing no code with `../slots`, `../crash` or `../blackjack`. Target role: HTML5 game client
developer on a multiplayer title.

This file is the **task map**: blocks, their gates, and the order they land in. The *why* — the
server's authority, the client's prediction, the shells that are not rewound, the dependency rules
— will live in **`CLAUDE.md`** (written in S0), which is the canon you keep current as code lands.

**Every block follows the house pattern:**

> **protocol change → sim (headless tests) → server → netcode → renderer/UI → tests green → tick off
> here + update `CLAUDE.md` (Rule 0) and delete the filled Gaps entries (Rule 1)**

**S0 landed 2026-10-03** — the workspace of ten empty units, strict TypeScript, the dependency
graph, purity and exactness enforced and proven against illegal fixtures (57 root tests), CI.
**S1 landed 2026-10-03** — the wire contract and three ADRs; `geom`, exact integer geometry and a
symmetric direction table; `protocol`, a binary codec held to hand-written bytes and to the document.
**S2 landed 2026-10-03** — `sim`, the room one tick at a time: 100,000 random ticks hold every
invariant, and a tank's own inputs replayed through `stepTank` reproduce the server's tank exactly.
**S3 landed 2026-10-03** — the server: a room of 12 on real sockets for five minutes, every tick
within 1.77 ms of its deadline at p99, every client holding exactly the view it was sent.
**S4 landed 2026-10-03** — bots that play through views and inputs alone, seated by the server to
fill a room to 6; the bench: a 12-tank tick 0.11 ms at p99, 1.75 KB/s down to the busiest client.
**C0 landed 2026-10-05** — `netcode`: ten virtual minutes at 150 ± 40 ms against the real `sim`, the
prediction the server's to the bit in every tick no other tank could touch; the server stopped
inventing a late input (protocol D15).
**C1 landed 2026-10-05** — the arena in a browser: on a phone profile with the CPU throttled 4×, 12
tanks and 36 shells at the display's rate, ten minutes with a flat heap, a hidden tab drawing
nothing; `sim`'s pinned run the same in Chromium, Firefox and WebKit.
**C2 landed 2026-10-06** — feel: three input schemes, own shells predicted and adopted, hits only
from the server; at 150 ms a key and a press each on the next frame, and 649 hits drawn in ten
minutes, every one the server's (protocol D16).
**C3 landed 2026-10-06** — the netcode made visible: the server ghost, the overlay and its graph,
a network lab on the server's side of the visitor's own socket (protocol D17), prediction and
interpolation switchable off, the kill replay; a stranger's steps through the page took 14 s.
**P0 landed 2026-10-06** — hardening: a silent socket given up, a hidden page suspended, a slow
socket skipped then closed (protocol D18), floods bounded; 240 load clients for 30 minutes, the
tick 1.06 ms late at p99, every short drop back on its own tank.
**P1 landed 2026-10-06** — packaging: one image serving the page beside the socket, a Render
Blueprint deploying once CI passes (ADR-0004); Playwright in CI — two players who find, watch and
kill each other through the lab and a drop, and a stranger's done-when in under 4 s; the README and
the architecture's diagrams.

---

## The game, in one screen

- **The room.** Up to 12 tanks on a 2,048 × 2,048 arena of walls and cover, bigger than the screen:
  the camera follows you, a minimap shows the walls and you. Bots fill a room to 6 and leave as
  people arrive, so the demo is never empty. Join at any moment; there is no lobby and no round to
  wait for.
- **A tank.** 3 hit points. The hull turns toward the stick at a limited rate and drives at 220
  units/s; the turret aims independently. One shell per 11 ticks (≈367 ms), at most 3 of yours in
  the air.
- **A shell.** 600 units/s, lives 1.6 s, **bounces off a wall once**, and dies on the second wall or
  on any tank — your own included. Bank shots around cover are the skill the game rewards.
- **Death and back.** A kill is a point; the room's top five sit in a corner. Respawn after 3 s at
  the spawn point furthest from enemies, with 1.5 s of a shield that cannot shoot. A repair crate
  (+1 hit point) appears at one of four fixed spots every 20 s.
- **Controls.** Keyboard + mouse (WASD, aim with the cursor, click or hold to fire); on a phone two
  thumb sticks — the right one fires while pushed; a gamepad through the Gamepad API.

Every number above is a constant in `sim`'s rules, pinned in [`docs/protocol.md`](docs/protocol.md)
§ Rules at S1 and changed only there.

## What it exists to show

The other three projects synchronise *outcomes*: a spin decided before it spins, one shared
multiplier, a hand of decisions. Here every player **steers**, and every input fights the latency.
That is the problem this repository exists to solve, in the industry's standard shape:

1. **The server is the only authority.** It steps one world at 30 Hz from everyone's inputs and
   sends each client a snapshot of what that client may see.
2. **Your own tank is predicted.** The client runs the same `sim` on its own inputs at once, keeps
   the ones the server has not acknowledged, and when a snapshot arrives, rewinds to it and replays
   them. A correction the eye could see is smoothed away, never snapped.
3. **Everyone else is interpolated** ~100 ms in the past between two snapshots that both exist. That
   delay is a buffer that adapts to the link's jitter.
4. **Shells are not rewound; they are fast-forwarded.** A shell fired by your input starts on the
   server where your prediction drew it, moved forward by your half round trip (capped at 100 ms).
   Hits are decided only on the server, at its own present.
5. **The wire is bytes, not JSON.** Positions are quantised to ⅛ unit, aims to 1/1,024 of a turn;
   snapshots are deltas against the last one sent on the socket; each client is sent only what
   lies within its view.

And the client makes all of this **visible**: a ghost of the server's truth over your own predicted
tank, the snapshot buffer, corrections per second, bytes per second — and a network lab that breaks
only your own connection.

---

## Task map

| Block | Delivers | Gates on | Status |
| --- | --- | --- | --- |
| **S0** | Workspace, strict TS, boundary lint, purity tests, CI, `CLAUDE.md` | — | ✅ (landed 2026-10-03) |
| **S1** | `protocol` · `geom` — the binary wire, quantisation, the direction table, the contract and ADRs | S0 | ✅ (landed 2026-10-03) |
| **S2** | `sim` — the world step: tanks, shells, ricochets, damage, respawn, the arena; pure and headless | S1 | ✅ (landed 2026-10-03) |
| **S3** | `apps/server` — rooms, the tick loop, input queues, snapshots with interest and deltas, clock sync | S2 | ✅ (landed 2026-10-03) |
| **S4** | `bots` + `tools/bench` — bots that play through inputs alone; tick cost and bytes per client measured | S2 | ✅ (landed 2026-10-03) |
| **C0** | `netcode` — socket, clock, prediction and reconciliation, the interpolation buffer | S1, S2, S3 | ✅ (landed 2026-10-05) |
| **C1** | The arena on screen — Phaser scene, generated art, camera, minimap, smoothing | C0 | ✅ (landed 2026-10-05) |
| **C2** | Feel — three input schemes, own shells predicted, hits and deaths, the scoreboard | C1 | ✅ (landed 2026-10-06) |
| **C3** | The netcode made visible — the server ghost, the debug overlay, the network lab, the kill replay | C2, S3 | ☐ |
| **P0** | Hardening — reconnect, hidden tabs, slow clients, hostile inputs, load | C2, S3, S4 | ☐ |
| **P1** | Packaging — deploy, README, Playwright E2E in CI | C3, P0 | ☐ |

**Legend:** ☐ not started · ◐ in progress · ✅ landed (add the date, as `✅ (landed 2026-10-04)`).

**Build order:** `S0 → S1 → S2 → (S3 · S4 in parallel) → C0 → C1 → C2 → C3 → P0 → P1`.
S4 needs nothing after S2 and can fill any wait. C0 runs the same `sim` the server does — that is
the prediction — so it gates on S2 as well as S3. P0's load needs S4's bots.

---

# Part I — Core & server

## Block S0 — Workspace foundations

_1 day. Nothing else may land before it._

- [x] pnpm workspace + Turborepo, `packages/*`, `apps/*`, `tools/*`, catalog-pinned tool versions.
- [x] Strict TypeScript — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `dist`
      builds per unit. The base tsconfig carries no DOM lib and no Node types; flavours opt in.
- [x] `dependency-cruiser` encoding the graph below, including the forbidden paths to `../slots`,
      `../crash` and `../blackjack` (by path and by `@slot/*`, `@crash/*`, `@blackjack/*` name).
      `tests/boundaries.test.ts` proves every rule fires against `config/fixtures/`.
- [x] `tests/purity.test.ts` — no clocks, no `Math.random`, no I/O or globals in `geom`, `protocol`,
      `sim`, `bots`; **no `Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow`, `Math.exp` in `sim`
      and `geom`** — their results are not specified to the bit, and a client that predicts with
      them disagrees with the server. One fixture per package. The `any` / `!` / `as` bans proven
      alongside. **Diverged:** the exactness ban is every function ECMAScript leaves
      *implementation-approximated* — the trigonometric and hyperbolic families, `exp`, `log`,
      `pow`, `cbrt`, `hypot` — and the `**` operator; `Math.sqrt` stays legal, and the fixture
      proves both halves. `protocol` is pure but not held to it: a codec computes no position.
- [x] ESLint + Prettier + husky/lint-staged; CI running `pnpm check` on push.
- [x] Ten empty units — six in `packages/`, two apps, two tools — whose `src/index.ts` names the
      block that fills each one.
- [x] `CLAUDE.md`: the project description, the five points above as the decisions everything hangs
      on, the package table, the dependency rules, Rule 0 and Rule 1, Gaps.
- [x] A README stub: what this is, where the canon is.

The graph S0 encodes:

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

Hard rules on top: **`bots` may not import `sim`** — a bot sees exactly the snapshot a player is
sent and acts only through inputs, so it cannot see through walls or cheat by construction.
**`renderer` may not import `protocol`** — it draws pictures, not messages. **Phaser stays in
`renderer` and `apps/web`.** **`apps/web` reaches `sim` only through `netcode`.**

**Done when:** `pnpm check` is green on an empty workspace, and a deliberately illegal import
(`bots` → `sim`, `renderer` → `protocol`, `sim` using `Math.sin`) fails CI. **Met 2026-10-03:**
57 root tests, each illegal fixture rejected by its rule's name and each allow-list accepted; and in
the real workspace, with `bots → sim` and `renderer → protocol` declared in `package.json` and
built, `lint:boundaries` still reports both, and `Math.sin` in `packages/sim/src` is a lint error.

## Block S1 — Contracts: protocol, geom

_2 days. Write this before anything moves on screen. Everything is downstream of it._

- [x] **The wire contract is pinned** in [`docs/protocol.md`](docs/protocol.md) (2026-10-03): the
      handshake (`hello` with a name and an optional resume token → `welcome` with your entity, the
      token, the tick and the arena), client → server `input` and `ping`, server → client
      `snapshot`, `roster`, `pong` and `error`; every field's bytes, the units, the delta rule, the
      events, the error taxonomy, and § 8 Rules — every number of "The game, in one screen".
      **Diverged:** events ride inside the snapshot of their tick, not in a message of their own;
      names and scores are a `roster` sent whole when they change.
- [x] **The load-bearing decisions are ADRs** (2026-10-03) —
      [ADR-0001](docs/adr/ADR-0001-server-authority-and-prediction.md) (the server is the
      authority; your tank is predicted, the rest interpolated),
      [ADR-0002](docs/adr/ADR-0002-shells-fast-forwarded.md) (shells fast-forwarded by the shooter's
      half round trip, not targets rewound — right for slow, visible projectiles, wrong for a
      hitscan rifle), [ADR-0003](docs/adr/ADR-0003-websocket.md) (WebSocket and its head-of-line
      blocking, over WebTransport or WebRTC data channels — and what the protocol drops because of
      it).
- [x] `packages/geom`: circles against axis-aligned boxes, a **swept** circle against a box, exact
      as fractions of integers and compared by cross-multiplication; reflection off a face as an
      operation on the direction's index. **The direction table**:
      [`golden/directions.py`](packages/geom/golden/directions.py) computes the first octant and
      fills the rest by symmetry, so the table is *exactly* symmetric and a reflected velocity is
      the old one with a component negated, to the bit; `tests/golden-fresh.test.ts` reruns it.
      `nearestDir` turns a mouse offset into a direction by cross products, no `atan2`.
      **Diverged:** the world is integers in eighths of a unit (D1) — the "quantisation helpers"
      became the world's own grid, and nothing is ever rounded to the wire.
- [x] `packages/protocol`: a hand-written binary codec over `DataView`, little-endian, one encoder
      and one decoder per side; a read past the end sets a flag rather than throwing, and a frame
      is refused as a value for truncation, trailing bytes, a reserved bit or an out-of-range field.
      `diff(base, next)` and `apply(base, snapshot)` for views: tanks by field mask, a position as an
      `i8` step when small; shells as starting conditions, sent once (D5); `apply` refuses a delta
      that is not of its base. Strict UTF-8 by hand for names, and `validName` (no controls, no
      bidi overrides). `RULES` — the game's numbers — live here, because the bots play by them
      (D6). `tests/protocol-doc.test.ts` holds § 4's messages, § 6's events, § 7's errors and
      § 8's rules to the code. **Diverged:** no snapshot acknowledgements — over TCP the last frame
      *sent* on a socket is the baseline (D4); `ack` acknowledges inputs only.
- [x] Golden test: every message written by hand beside its bytes — also written by hand, field by
      field from the document, never printed by the encoder; both directions held to them; every
      truncation of every fixture refused as `truncated`, a trailing byte as `trailing bytes`, and
      no client frame taken for a server one or the other way round. 26 more frames, each one field
      away from a valid one, refused with their reason.

**Done when:** every message round-trips at its pinned size, the direction table matches its
generator, and a swept shell never passes a wall in 10⁶ random shots at every speed up to twice the
pinned one. **Met 2026-10-03:** 100,000 random messages each way decode to themselves; 20,000 ticks
of a moving world — tanks driving, respawning and leaving, shells fired and landing — go through
`diff`, the bytes and `apply` and arrive as the server's view, at under 200 bytes a tick; the table
equals its script's output; and 10⁶ random shots at radii up to 8 units and speeds up to 320 eighths
a tick, against walls from 16 units thick, each meet the wall exactly on its grown boundary and no
later than a 64-point sampling of the move does. Two mutants of `sweep` — the slabs' overlap check
removed, and entries before the move accepted — each turn the suite red.

## Block S2 — The world step

_3 days. The part reviewers actually read._

- [x] `packages/sim`: `step(world, commands) → { world, events }` at a fixed 1/30 s (2026-10-03).
      Tanks — the hull turning toward the stick or reversing, the move taken along x then y as far
      as it is free, so a tank stops flush and slides along a wall; shells — born at the centre,
      flown `muzzle` and the shooter's `lead` at once, swept against every wall, off the first and
      dead on the second, sparing their own tank until they have bounced; damage, the shield
      absorbing, death, the score, respawn at the free spawn point furthest from the living; crates.
      **The engine returns events; it never emits.** Spawn ties and crate spots are drawn from a
      mulberry32 state carried in the world. The order of a tick is a rule, written in
      [`docs/protocol.md`](docs/protocol.md) § 8.1. **Diverged:** no `tick` argument — the world
      carries its tick; `join` and `leave` beside `step`; `shot` names its shooter (protocol D9),
      found when a point-blank shell died in the tick it was fired and its event had no owner left.
- [x] **The world is integers at every step** — eighths and directions throughout (protocol D1), so
      there is nothing left to quantise. A wall contact is snapped exactly onto the grown face as
      well; a mutant without the snap survives the soak, because a contact time computed as an
      exact fraction already lands on the face — the snap is a second guard, not the only one.
- [x] `stepTank(tank, command, arena, obstacles = [])` exported on its own — the prediction's entry
      point, and the function `step` calls for every tank, which passes the other live tanks as
      obstacles; `stepShell(shell, arena)` beside it, the flight a client runs on the shells it
      holds (protocol § 5.3).
- [x] `view(world, viewer, events, ack) → View` — the one door to the wire: the tanks and shells
      within `viewHalf` of the viewer on both axes (a square, protocol D10, 880 units each side),
      its own timers, the crates, and the tick's events filtered by protocol § 6.
- [x] The arena as data — `ARENA_0` in `protocol` beside `RULES`, since the bots path round its
      walls and may not import `sim` (protocol D11): four-fold symmetric, 21 walls with the edges,
      eight spawn points, four crate spots. `arena.test.ts`: the edges close it, no two walls
      touch (no seam for a shell to find), every spawn and crate clear, and every one reachable
      from every other on an 8-unit grid of tank centres.
- [x] Tests: every rule on staged worlds (`rules.test.ts`, 23) · 100,000 ticks of 12 tanks on random
      inputs, players leaving and arriving, with every invariant checked every tick
      (`soak.test.ts`) · the events explain every change of hit points and score, every tick · every
      tenth tick, every player's view through `diff`, the bytes and `apply`. **Diverged:**
      determinism is a pinned hash of 5,000 ticks rather than a rerun in happy-dom — happy-dom runs
      in V8 like Node and would prove nothing about another engine. C1 replays the pinned run in
      Chromium, Firefox and WebKit through Playwright, which does.

**Done when:** 100,000 random ticks hold every invariant, and replaying any tank's inputs through
`stepTank` from any of its snapshots reproduces the server's tank exactly whenever no other tank
touched it. **Met 2026-10-03** (`soak.test.ts`, ≈8 s): 100,000 ticks with no tank in a wall or
another tank, no shell inside a wall or off the arena, no tank over `maxShells`, hit points and
scores equal to what the events say — over 1,000 kills, 10,000 bounces and 50 crates, so it was a
game — and over 100,000 views carried across the wire. 30,000 ticks of predictions restarted from
the server every 10 ticks and replayed through `stepTank` with no obstacles: **0 mismatches** in
over 200,000 replayed ticks. "No other tank touched it" is taken conservatively — none within two
radii and three ticks' driving — after a first, exact reconstruction of the step's order missed the
tanks that respawned or died within the tick and reported 13 false mismatches. A mutant that drives
every tank with no obstacles fails the soak at tick 122.

## Block S3 — The server

_2–3 days._

- [x] `apps/server` (2026-10-03): Fastify for `/health` and `/ready` (rooms, players, sockets, the
      tick's lateness and work at p99); `ws` for the game at `/play`, binary frames of at most 256
      bytes. Every inbound frame decoded and refused as a value if malformed; a socket's third is
      `MALFORMED` and closed; anything before `hello` too, a wrong version `VERSION`, a name the
      rules refuse `NAME`, more than 60 inputs in a second `RATE`, no `hello` within 5 s closed.
      The work is in `Room` and `Lobby`, which know no socket — a player's socket is a `Peer` —
      and `Connection`, one socket's side of the protocol; `sockets.ts` is the `ws` wiring. The
      page is P1's.
- [x] Rooms: the fullest room with a seat, a new one only when none has, `FULL` past
      `RICOCHET_MAX_ROOMS`; a room with no connected player for a minute closes, its tokens with
      it. Names by `protocol.validName`.
- [x] **The tick loop** (`ticker.ts`): deadlines from the first tick, `start + n · period`; it
      sleeps to 1.5 ms short of each and spins the rest on `setImmediate`, which yields to the
      sockets; more than five ticks behind (a paused process) it rebases instead of replaying.
      Every room steps on the one loop — a unit of work, not a timer of its own. Lateness and work
      recorded per tick, the last ten minutes kept.
- [x] **Input queues**: one per player, applied one a tick in `seq` order, a repeated or older `seq`
      ignored, the oldest dropped past `inputQueueMax`; the last applied `seq` is every snapshot's
      `ack`. **Diverged:** an empty queue holds the last input's stick and aim but **not its
      trigger** (protocol D14) — a repeated shot would be a shell the client never predicted.
      **Changed at C0** (protocol D15): an empty queue holds nothing, and the tank stands — a held
      stick was a tick the client's prediction never made.
- [x] **Snapshots** every tick to every connected player: `sim.view`, `protocol.diff`ed against the
      last view sent on that socket; against nothing for a socket's first and after a resume.
      **Diverged:** the roster follows the `welcome` (the first version sent it from inside the
      join, before the welcome — caught by the connection's test), and goes out whole on a join, a
      leave or a score.
- [x] Clock sync: `pong` carries the room's tick and the microseconds into it. **Diverged:** the
      server measures each socket's round trip itself, with WebSocket ping frames once a second —
      answered by the browser below any JavaScript — the median of the last five; five unanswered
      and the socket is closed (protocol D13). The protocol's `ping` is the client's clock sync
      only.
- [x] Shells fast-forwarded per ADR-0002: `lead` = half the measured round trip in ticks, capped by
      `sim` at `fastForwardMax` (tested at 100 ms → two ticks).
- [x] A resume token per player, 16 bytes from `crypto.randomBytes`: a dropped socket's tank stands
      for `resumeGrace` ticks; a `hello` with the token gets it back with a fresh baseline and
      closes any socket still holding it; after the grace the token is forgotten.
- [x] Integration test (`server.test.ts`): 12 headless clients on real sockets, each driving and
      firing at random 30 times a second and pinging twice a second, applying every snapshot to the
      view it holds; the server records every view it sends and checks each against its world.
      Ten seconds in CI; `pnpm --filter @ricochet/server soak` runs the five minutes. **The 2 ms is
      the soak's alone:** CI's first run measured 11 ms at p99 on a shared runner with every other
      package's suites beside it, so the ten-second run holds only that no tick is a whole period
      late. At S4 even that failed — 153 ms beside the new bot room and grid tests, the process
      starved — and `pnpm test` now runs the package suites one at a time.

**Done when:** a room of 12 runs for 5 minutes with every tick on its deadline within 2 ms at p99,
and each client's received snapshots, applied in order, reproduce that client's view of the
server's world at every tick. **Met 2026-10-03** (`pnpm --filter @ricochet/server soak`, one
laptop, the clients in the same process as the server): 9,007 ticks in 301 s, none skipped;
lateness p50 0.015 ms, **p99 1.77 ms**, worst 22.6 ms (one tick); a tick's work p99 3.0 ms for 12
players, their views and their bytes. Every one of the 12 clients held, at every tick it received,
exactly the view the server sent it — the shells as starting conditions from when each entered its
view — and every view sent was the world as it stood. Not yet measured: a server whose sockets are
on other machines, which P0's load tool and P1's live demo are.

## Block S4 — Bots and the bench

_1–2 days. Can run in parallel with S3._

- [x] `packages/bots` (2026-10-03): `decide(view, memory) → { input, memory }`. The bot sees the
      view a player in its seat would hold and answers with the input a player would send.
      **Diverged:** it is handed the memory back rather than keeping it, so a bot is as pure and
      replayable as `sim`. It steers toward the nearest tank it can hurt, a crate when it is down to
      its last hit point, or a spawn or crate spot to wander to. It paths round the walls on a
      32-unit grid built once per arena: Dijkstra fields shared between bots, 0.07 ms each, and the
      furthest cell along the path it can drive straight to. A target in sight it circles rather
      than rams. It aims where the target will be when the shell arrives, firing tick included,
      off by a uniform error of `spread` directions: 12, 24 or 40, the difficulty as a number. When
      the straight line is blocked it banks: it reflects the target in every wall face, aims at the
      image, and flies the shot with `geom` the way the server will. It keeps only a shot that lands
      on the leg it was aimed for and passes clear of its own tank. It works loose from a tank it
      is stuck on. Its randomness is a mulberry32 seed in its memory.
- [x] The server seats bots to fill a room to 6 (`RICOCHET_BOTS`, default `botsFillTo`): a bot is a
      player with no socket and no token, flagged in the roster. The newest leaves as a person
      arrives and one comes back when a person's grace runs out. The lobby seats people by people,
      not tanks.
- [x] `tools/bench` (`pnpm bench`): rooms of 6, 12 and 24 bots, five minutes of play each, every
      tank treated as a connected player. It times the tick (`step`, views, diffs, encodes) and the
      bots apart, at p50 and p99. It counts the bytes down per client with framing and the roster,
      delta and whole, at 30 Hz and at 15, deflated alone and in context. Results to
      [`docs/bench/results.md`](docs/bench/results.md); what was decided from them in
      [`docs/bench/README.md`](docs/bench/README.md). It fails over budget.
- [x] `tools/bench/src/bots.test.ts`: in 10 minutes of a bot-only room of 6, every bot scores
      (27–49 kills each), every bot dies (40–47 times), fewer than a quarter of deaths are a
      ricochet coming home (23 of 267), and every score is the kill events.

**Done when:** `pnpm bench` reports a 12-tank tick under 1 ms at p99 on a laptop and under
**6 KB/s down per client** with deltas, and the numbers are pinned in `docs/bench/`. **Met
2026-10-03** (one laptop, Apple M4 Pro, Node 24): a 12-tank tick **0.112 ms at p99** (`step` alone
0.052); 12 bots deciding 0.31 ms at p99; down to a client of 12, **1.75 KB/s** at worst with deltas
against 4.68 KB/s whole. 24 tanks, twice a room: 0.35 ms and 3.05 KB/s. 15 Hz halves the bytes; a
frame deflated alone keeps 93 % of its size, so frames stay uncompressed (protocol § 9).

---

# Part II — Client

## Block C0 — `netcode`

_3 days. **No DOM in this package.** The heart of the project._

- [x] Transport (2026-10-05): a `Connect` that opens a socket and reports `open`, `message` and
      `close`, a `Clock` and `Timers` *handed in*, so the browser, the load tool and the tests run
      the same code; every frame decoded. Connection states as a stream (`onState`): `connecting`,
      `joining`, `live`, `reconnecting`, `outdated`. **Diverged:** two more — `refused` for `NAME`
      (ask for another name, do not retry) and `closed`; `FULL` and `RATE` are `reconnecting` after
      5 s and 1 s; a snapshot not of its base reconnects at once (protocol § 5.2); a dropped socket
      retries with its token, 250 ms doubling to 4 s.
- [x] Clock: the server tick estimated from `pong`s — the shortest round trip of the last six — and
      slewed toward a new estimate at 5 % of a tick a tick, never backward; jumped only past ten
      ticks out. Five pings 100 ms apart after a welcome, then one every 2 s.
- [x] **Prediction and reconciliation**: each client tick samples an input, gives it a `seq`, sends
      it, applies it to the own tank through `sim.stepTank`, and keeps it. On a snapshot: drop the
      inputs it acknowledged, set the own tank to the server's, replay the rest. The visible error
      is an offset decaying with a 33 ms time constant (5 % left at 100 ms); a respawn — a change of
      life, or over two radii — is drawn at once. **Diverged:** (1) the server consumes inputs as
      they come, so a client tick is the server's clock plus a lead and only the *rate* is the
      server's; a queue left deep by a stall's burst is shortened by sending one input fewer when
      even the quickest of five seconds' inputs waited 3 ticks there, and past a round trip and a
      full queue unacknowledged the client stops sending. (2) **Protocol D15** — the server held a
      late input's stick, a tick the client never predicted; it now stands the tank, and the
      prediction is exact through any jitter (`netcode.test.ts` shows both rules on the same link).
      (3) Tank against tank is predicted after all (the open question below): the own tank stops at
      another where that one will be — the newest snapshot carried on along its last step, one step
      further for a lower id, which drives first (§ 8.1).
- [x] **Interpolation**: every other entity drawn between the two views around `serverTick − delay`;
      the delay is two snapshot intervals plus the 95th percentile of lateness above the link's
      least, within 2–12 ticks; past the newest, one tick extrapolated along the last step, then
      held. The drawn time moves at 90–110 % of the server's while it follows a new delay, never
      backward. **Diverged:** lateness is measured against the server's clock, so "the newest
      snapshot expected" is the server's present less the least lateness seen.
- [x] The picture out: `frame(now) → { tick, me, others, shells, crates, offset, from, to }`.
      **Diverged:** one `offset` (the own tank's correction), and `from` / `to` — the ticks drawn
      between, which the test holds to what was received. The own tank is drawn between its last two
      predicted ticks; shells are flown from their starting conditions with `stepShell`, and a
      fraction of a tick by `fly`, so a bounce is drawn on its two legs.
- [x] Tests against a fake server running the **real `sim`** in virtual time, through a link that
      delays, jitters and stalls each way as TCP does (`src/__fixtures__/net.ts`, `netcode.test.ts`):
      every input applied once at most, in order · two stalls of 1 s and their bursts · a clock 50 ms
      a minute fast and slow · D15 against D14 · and the parts alone (`clock`, `prediction`,
      `timeline`, `client` — states, resume, refusals).

**Done when:** a headless client at 150 ms ± 40 ms drives a scripted route for 10 minutes and its
predicted tank agrees with the server's after every reconciliation in 100 % of ticks where no other
tank touched it, and within one unit in 99 % of those where one did; remote tanks are never drawn
from a snapshot that does not exist. **Met 2026-10-05** (`netcode.test.ts`, ten virtual minutes,
under a second of work): of 17,990 reconciliations judged, **all 17,750** in ticks where no other
tank came within reach were the server's tank to the bit — hits and deaths among them, since a shell
strikes after the driving; **194 of 195** where one did were within one unit (191 exact), the worst
52 eighths; all 45 respawns drawn at once. 35,981 frames, none drawn from a tick the client had not
received or more than one past its newest; 17,982 inputs applied, none dropped, one tick in ten
minutes the server's queue ran dry; the clock within 0.53 of a tick; the others 104 ms behind.
"Touched" is taken as another tank's centre within two radii and a tick's drive each, at that tick
or the one before. **The contact figure varies by run:** over eight seeds of the same scenario, 986
of 999 contact ticks within one unit (98.7 %), the worst run 64 of 72 — the own tank following
another that turns or sets off, which no client can know before the snapshot says; the
no-contact figure is 100 % in all eight.

## Block C1 — The arena on screen

_3 days._

- [x] `apps/web` bootstrap (2026-10-05): Vite, one Phaser 4 game, a DOM layer over it (name entry,
      the connection state, the scoreboard), `netcode` wired through the browser's `WebSocket` on
      the page's own origin. `pnpm dev` runs both, the workspace built first. **Diverged:** C1 needs
      something to drive with, so keyboard and mouse came forward from C2 (`KeyboardMouse`); C2
      adds the sticks and the gamepad behind the same `intent()`.
- [x] `packages/renderer`: the arena, tanks (hull and turret as separate sprites, tinted per player
      from twelve hues), shells, crates and walls from textures **generated at boot** — no shipped
      art, one atlas (a `DynamicTexture` drawn once by a Graphics) — the camera following the own
      tank with an 80-unit lead toward the aim, eased at any frame rate alike, the minimap on its
      own camera. **Diverged:** the floor is the clear colour and a grid of lines, not a tiled
      sprite (`docs/perf/`); the canvas draws at most 2 device pixels per CSS pixel.
- [x] Rendering at the display's rate from `netcode.frame(now)`: Phaser's `update` asks for the
      picture at `performance.now()`; the ticks never drive frames.
- [x] Particles and sound kept within a budget: three pooled emitters (muzzle flashes, ricochet
      sparks, bursts where a shell ends) capped at 60, 160 and 200 particles; three sounds
      synthesised at boot into Phaser's audio cache, six at most at once, fainter with distance;
      sprites pooled by id. **Diverged:** the effects are found by comparing pictures
      (`ShellWatch`) — a shell new beside its owner, a direction changed, a shell gone near a tank —
      since `netcode` surfaces no events yet; C2's hits come from the server's.
- [x] Phaser's own physics **not used** — the world's physics is `sim`'s. Phaser draws, runs the
      cameras and the sound; the keys are the page's own listeners.
- [x] **Diverged — the loop sleeps while the tab is hidden.** Phaser 4 marks a hidden game paused
      and leaves the stopping to the browser's frame timer, which a measurement found still
      drawing; `mountArena` puts the loop to sleep on `hidden` and wakes it on `visible`.
- [x] The gap left since S2: `sim`'s pinned 5,000-tick run, bundled as for a page, replayed in
      three engines (`e2e/determinism.spec.ts`, `pnpm e2e`, CI's `engines` job) — Chromium and
      WebKit end in hash `68b4d373` here; Firefox would not download on this machine's link, and CI
      runs all three.

**Done when:** 12 tanks and 36 shells hold 60 fps on a 4×-throttled mobile profile, memory is flat
across 10 minutes of play, and an idle background tab draws nothing. **Met 2026-10-05**
(`pnpm --filter @ricochet/web perf`, [`docs/perf/`](docs/perf/README.md); Chromium as a 375 × 812
phone at DPR 3, the CPU throttled 4×, an Apple M4 Pro's GPU): the stress page's 12 tanks and 36
shells drew 2,401 frames in 20 s at the display's 120 Hz, **none over 25 ms**, the loop's work 2.0
ms at p99; ten minutes against eleven bots, 72,095 frames, none over 25 ms, the heap after a forced
GC **7.38 MB at the start and 7.64 at the end**, never above 8.31; the page made hidden drew **0
frames** in 3 s and resumed after. On SwiftShader — no GPU, a bound below any phone — the stress
page ran at 62 fps with 8 of 1,244 frames over 25 ms; a real phone is P1's.

## Block C2 — Feel

_3 days._

- [x] Three input schemes behind one `intent()` (2026-10-06): keyboard + mouse, two touch sticks
      (the aim stick fires while pushed past 55 % of its travel), a gamepad (the standard mapping).
      The scheme switches to whatever was touched last; the sticks appear only once the screen is
      touched. **Diverged:** a second door, `peek()` — the intent between ticks, consuming nothing
      — so the own tank is drawn toward the next input and a press fires on its frame; and a press
      is latched until an input carries it, so a click shorter than a tick still fires.
- [x] **Own shells predicted**: a press spawns a shell at once, tagged with the input's `seq`; the
      snapshot whose `shot` event carries that `seq` adopts the server's shell under the same drawn
      id, the step decaying as for the tank; a shot acknowledged with no `shot` (the tank dead,
      shielded, reloading or out of shells) fizzles. Muzzle flash and recoil at the press.
      **Diverged:** (1) the gun is predicted — the timers then the trigger, as `sim.step` runs them,
      replayed with the tank, the shells in the air counted by their flight — so a refused shot is
      not drawn at all: 26 of 945 fizzled in ten minutes, the tank killed in between. (2) Own
      shells fly in the **server's present**, not the others' interpolated past — that is where
      the server's shell will be (ADR-0002). (3) **Protocol D16:** the server's fast-forward adds
      the ticks the input waited in its queue, and the client eases its shell back by what the
      100 ms cap leaves over; the step at adoption fell from 34 units to 1.5 at 150 ms.
- [x] **Hits are never predicted**: sparks on a tank and its white flash, a kill's burst, a spawn's —
      only from the server's events, shown when the drawn time reaches their tick (the own shells'
      hits on arrival, in the present they fly in). A predicted shell over a tank the server says it
      missed flies on; an own shell drawn past its wall when the server's hit arrives still shows
      the hit. **Diverged:** C1's renderer inferred a hit where a shell vanished near a tank; that
      guess is gone.
- [x] Death and respawn: the killer named (or the own ricochet), the count to the respawn, the camera
      holding on the place, the shield's glow on respawn. The room's top five, your place if you
      are below them, a kill feed of the last four.
- [x] Settings remembered: sound, the sticks' size and side, a small network overlay (round trip,
      delay, unacknowledged, corrections, shots and their step, bytes, frames) that C3 grows.

**Done when:** at 150 ms of round trip, the own tank moves on the frame after the key, a shell
leaves the barrel on the frame after the press, and in 10 minutes against bots no predicted shell
is ever drawn hitting a tank the server says it missed. **Met 2026-10-06**
(`pnpm --filter @ricochet/web feel`, [`docs/perf/`](docs/perf/README.md); the page and the real
server with eleven bots behind a proxy holding every byte 75 ms each way): a key drew the own tank
moved on the **next frame in 20 of 20** trials, a press drew its shell on the **next frame in 20 of
20**; in ten minutes of play, **649 hits drawn, each a `hit` the server sent**, and 922 own shells
ended, each at a hit, a wall, its age or a refusal — none vanishing at a tank it passed. Touch and a
stand-in gamepad each drove and fired. In `netcode`'s own ten minutes at 150 ± 40 ms
(`netcode.test.ts`), every hit drawn was one the server sent, each once.

## Block C3 — The netcode made visible

_2 days. This is what a stranger opens the demo to see._

- [x] **The server ghost** (2026-10-06): a toggle that draws, over the own predicted tank, an outline
      where the server last said it was, and over every remote tank where its newest snapshot puts
      it — the prediction ahead, the interpolation behind, both on screen. At 300 ms the own ghost
      trails a driving tank by 55–59 units; with the prediction off it is 15 units *ahead* — the
      own tank then interpolated like everyone else.
- [x] **The overlay**: round trip and jitter, the interpolation delay and the buffer's depth,
      unacknowledged inputs and the lead, corrections per second and their size, bytes per second
      each way, the tick, the lab's settings; a graph of the last ten seconds — the round trip, the
      delay and the buffer as lines, the corrections as bars. **Diverged:** the round trip shown is
      the newest pong's, not the clock's least of twelve seconds — and the lab found the input cap
      reading that least too: after adding 300 ms the client held its own inputs back for twelve
      seconds, the tank stuttering. The cap takes the newest as well now, and a lab change re-syncs
      the clock with five quick pings.
- [x] **The network lab**, per connection on the server as in the earlier projects — so a dropped
      reply or a stall is real, and a live demo's lab breaks only the visitor's own link: add
      latency (0 / 100 / 300 / 600 ms), add jitter (0 / 50 / 150 ms), stall for 2 s, drop the
      socket. Prediction and interpolation switchable off, so the difference is felt, not
      explained. **Diverged:** (1) two client messages, `lab` and `stall` (protocol D17), into a
      `Link` of two lanes per socket that delay and bunch frames and never lose or reorder one —
      and the server's WebSocket pings go through them, so its own round trip, which the
      fast-forward reads, sees the lab's latency; a ping carries its id, and a socket is dead after
      10 s unanswered, not five missed pings, which a 5 s stall would trip. (2) The drop is no
      message: the page lets go of its own end, the one close a proxy passes on (the crash project's
      P1), and the client comes back onto the same tank and sends the lab again. (3)
      `RICOCHET_LAB`: on in development, opt-in in production.
- [x] **The kill replay**: on death, the last 3 seconds from the client's own snapshot history, at
      half speed, with the shell's path and its bounce drawn — the server's truth, not the
      prediction. The bounce and the hit are found by `sim.fly` itself: the least distance at which
      the flight bounces, or reaches the tank. **Diverged:** it plays on a canvas of its own, framed
      on the death, the killer and the path, not in the arena — six seconds at half speed outlive a
      three-second respawn, and the player is driving again by then.
- [x] A short "how this works" panel linking the ADRs and the protocol.

**Done when:** a stranger can turn on the ghost, add 300 ms in the lab, switch prediction off and
on, and see the difference in their own tank in under a minute. **Met 2026-10-06**
(`pnpm --filter @ricochet/web lab`, [`docs/perf/`](docs/perf/README.md); the built page and server
with bots, Chromium driving the page through its DOM only): from the page's load, the name, the lab,
the ghost and 300 ms, then four keys with the prediction on, four with it off and four on again, in
**14 s**. A key drew the own tank moved on the **next frame** with the prediction on (8 of 8), and
after **43–44 frames** at 120 Hz — the round trip and the interpolation delay — with it off. A 2 s
stall held the snapshots 2,017 ms; a drop came back onto the same tank in 266 ms with the lab on the
new socket; a death showed its replay, the fatal shell traced to 0.1 units of the tank's edge.

---

# Part III — Hardening & packaging

## Block P0 — Hardening

_2 days._

- [x] Reconnect (2026-10-06): a socket dropped mid-fight resumes the same tank within 10 s with
      nothing replayed twice; after 10 s the tank is gone and the client rejoins as new.
      **Diverged:** the client had no way to notice a link that died without closing; it gives a
      socket up after 6 s of silence now — a snapshot comes every tick — well inside the grace.
- [x] A hidden tab: the browser stops its frames and slows its timers, so the client stops sending
      inputs; the server stands the tank (protocol D15); the tab back in view snaps to the truth and
      resumes prediction. **Diverged:** the page says so (`client.setHidden`) rather than leaving
      it to the throttled timers, which sent an input a second; and shown again, the client drops
      the effects of the time away instead of drawing a burst of them.
- [x] A slow client: when a socket's `bufferedAmount` passes 16 KB, the server skips its snapshots
      (the next is a delta against what it last sent, so nothing breaks) instead of queueing them,
      and the skipped ticks' events ride that next one; past 64 KB, it closes it (protocol D18).
- [x] Hostile inputs: an input is a direction and buttons, never a position, so speed is not
      something a client can claim — a hundred inputs a tick move a tank one step a tick; inputs
      beyond the queue's bound dropped; a client sending more than 2× the tick rate refused with
      `RATE`, and its pings and lab frames past twenty a second ignored; a token leads only to its
      own tank — forged, outlived or from a closed room, it joins anew.
- [x] `tools/load`: headless clients through `netcode` driven by `bots`' policy over the wire — 20
      rooms of 12 for 30 minutes against a production-mode server with the lab's faults on half of
      them (lagged, rough, dropping); the tick's p99, bytes per client, corrections per client,
      reconnects. Results to [`docs/load/`](docs/load/README.md). **Diverged:** a respawn no
      longer counts as a correction — it is drawn at once — so the corrections are the
      prediction's errors alone.

**Done when:** 240 clients for 30 minutes keep every room's tick within its deadline at p99, stay
under the bandwidth budget, and every dropped client that came back within 10 s found its own tank.
**Met 2026-10-06** (`pnpm load`, [`docs/load/`](docs/load/README.md); one laptop, the server and
six client threads): 20 rooms full for 30 minutes, the tick **1.06 ms late and 3.54 ms of work at
p99** against its 33.3 ms; **1.62 KB/s** down to the busiest client; **400 of 400** short drops back
on their own tank in 257 ms at worst, and **189 of 189** long ones — 13 s out, past the grace —
joined again as new; no reconnect nobody scheduled. The input queue stays at four: 0.5 corrections
a minute at 150 ± 40 ms, 4.6 at 300 ± 100 ms with a stall every 90 s.

## Block P1 — Packaging

_1–2 days._

- [x] One image, one origin (2026-10-06): the server serves the built page beside the socket
      (`RICOCHET_STATIC_DIR`; hashed assets for a year, `index.html` never); `Dockerfile`, CI
      builds and runs it and plays the E2E against it (the `image` job); a Render Blueprint
      (`render.yaml`, deploying once CI passes), its free tier's sleep and fresh start decided in
      [ADR-0004](docs/adr/ADR-0004-demo-host.md).
- [x] Playwright E2E in CI (2026-10-06, `e2e/duel.spec.ts`): two browser contexts join one room
      and each sees the other move; one shoots the other dead and both see the kill; the lab's
      300 ms in one of them leaves its own tank responsive and the other's view smooth; a dropped
      socket resumes the same tank. Beside it `e2e/stranger.spec.ts`, the done-when below, run
      against the local server, the image and the live demo. **Diverged:** the E2E found a
      gamepad's dead zone cut axis by axis, flattening any aim within 14° of level — it is the
      stick's push now (`stickOf`).
- [x] README (2026-10-06): a GIF above the fold — the ghost on, the lab adding latency, the tank
      still crisp — the five decisions in a paragraph each, the bench and load numbers, "try to
      break it".
- [x] [`docs/architecture.md`](docs/architecture.md) (2026-10-06): one tick on the server, one
      frame on the client, the input's life from the key to the acknowledgement, as diagrams.
- [x] The workspace README's row for this project — and its first line, which no longer says
      iGaming alone (2026-10-06).

**Done when:** a stranger can open the live link, play against bots, turn on the ghost, break the
network from the lab, and watch their tank stay under their thumb — in under two minutes.
**Measured locally 2026-10-06** (`e2e/stranger.spec.ts` against the built server serving the built
page, the lab on, six bots — the image's shape): from the name form to a dropped socket back on its
own tank in **3.6 s**; at 300 ms a key moved the own tank on **the next frame** predicted, **390 ms**
later with the prediction off, and on the next frame again with it back on. The live link's run
(`E2E_BASE_URL=… pnpm e2e:live`) follows the first deploy.

---

## Open questions — each decided in the block named

- ~~**Phaser 3 or 4**~~ — **decided at S0: Phaser 4** (4.2.1, the stable release on 2026-10-03), pinned in the catalog.
- ~~**Snapshot rate**~~ — **decided at C1: 30 Hz.** The page draws between snapshots at the
  display's rate either way, so the motion looks the same; what 15 Hz changes is the interpolation
  delay — two intervals, 133 ms instead of 66, the others that much further in the past to aim at —
  to save 0.8 KB/s (S4) the 6 KB/s budget does not need ([`docs/perf/`](docs/perf/README.md)).
- ~~**Tank against tank**~~ — **decided at C0:** tanks block and do not push, and the prediction
  stops the own tank where the other will be — the newest snapshot carried on along its last step,
  one step further for a lower id. With no guess, 44 of 150 contact ticks were off by up to a tick's
  drive; with it, 13 of 999 over eight runs (ADR-0001, amended).
- ~~**The interest radius**~~ — **decided at S2:** a square, `viewHalf` = 880 units each side of the
  tank (protocol § 8.3).
- **Gamepad on iOS Safari** — read through the standard mapping, which Safari supports; tested only
  with a stand-in pad in Chromium. (P1, on a real device)
