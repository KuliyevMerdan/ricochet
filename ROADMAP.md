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
| **C0** | `netcode` — socket, clock, prediction and reconciliation, the interpolation buffer | S1, S2, S3 | ☐ |
| **C1** | The arena on screen — Phaser scene, generated art, camera, minimap, smoothing | C0 | ☐ |
| **C2** | Feel — three input schemes, own shells predicted, hits and deaths, the scoreboard | C1 | ☐ |
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
      late.

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

- [ ] Transport: a socket, the handshake, every frame decoded; the socket, timers and the clock are
      *handed in*, so the browser, the load tool and the tests run the same code. Connection states
      as a typed stream: `connecting`, `joining`, `live`, `reconnecting`, `outdated`.
- [ ] Clock: the server tick estimated from `pong`s (the minimum-RTT sample of a window), so the
      client's tick runs aligned with the server's, and a drifting estimate is slewed, not jumped.
- [ ] **Prediction and reconciliation**: each client tick samples an input, gives it a `seq`, sends
      it, applies it to the own tank through `sim.stepTank`, and keeps it. On a snapshot: drop the
      inputs it acknowledged, set the own tank to the server's, replay the rest. The visible error
      between the old prediction and the new is kept as an offset that decays over ~100 ms — the
      tank never jumps, and never drifts from the truth either.
- [ ] **Interpolation**: every other entity drawn at `serverTick − delay` between the two snapshots
      around it; the delay adapts to the jitter seen (two snapshot intervals plus the 95th
      percentile of lateness, within bounds); a snapshot that arrives too late extrapolates at most
      one tick, then holds.
- [ ] The picture out: `frame(now) → { me, others, shells, crates, offsets }` — positions for the
      renderer at the display's rate, between the ticks.
- [ ] Tests against a fake server running the **real `sim`**, through a link that adds latency,
      jitter and stalls (a TCP link does not lose or reorder; it stalls — that is what is
      simulated): every acknowledged input applied once · a stall of 1 s followed by a burst ·
      a clock that drifts 50 ms a minute.

**Done when:** a headless client at 150 ms ± 40 ms drives a scripted route for 10 minutes and its
predicted tank agrees with the server's after every reconciliation in 100 % of ticks where no other
tank touched it, and within one unit in 99 % of those where one did; remote tanks are never drawn
from a snapshot that does not exist.

## Block C1 — The arena on screen

_3 days._

- [ ] `apps/web` bootstrap: Vite, one Phaser game, a DOM layer over it (name entry, the connection
      state, the scoreboard), `netcode` wired. `pnpm dev` runs both.
- [ ] `packages/renderer`: the arena, tanks (hull and turret as separate sprites, tinted per player),
      shells, crates and walls from textures **generated at boot** — no shipped art, one atlas —
      the camera following the own tank with a little lead toward the aim, the minimap.
- [ ] Rendering at the display's rate from `netcode.frame(now)`: the ticks never drive frames.
- [ ] Particles and sound kept within a budget: a pooled emitter for muzzle flashes, hits and
      ricochet sparks; no allocation per frame in steady play.
- [ ] Phaser's own physics **not used** — the world's physics is `sim`'s. Phaser draws, takes input,
      runs the camera and the sound.

**Done when:** 12 tanks and 36 shells hold 60 fps on a 4×-throttled mobile profile, memory is flat
across 10 minutes of play, and an idle background tab draws nothing.

## Block C2 — Feel

_3 days._

- [ ] Three input schemes behind one `input()`: keyboard + mouse, two touch sticks (the right one
      fires while pushed past a dead zone), a gamepad. The scheme switches to whatever was touched
      last; the sticks appear only on a touch screen.
- [ ] **Own shells predicted**: a press spawns a shell at once, tagged with the input's `seq`; the
      snapshot that carries the server's shell for that `seq` adopts it (the offset decaying, as
      for the tank); a shell the server refused (reload, three in the air) fizzles. Muzzle flash
      and recoil at the press.
- [ ] **Hits are never predicted**: sparks on a tank, its hit points, a kill — only from the server's
      events. A predicted shell that passes through a tank the server says it missed just flies on.
- [ ] Death and respawn: the killer named, the 3 s count, the camera holding on the place, the
      shield's glow on respawn. The room's top five, your rank if you are below them, a kill feed.
- [ ] Settings remembered: sound, the sticks' size and side, the network overlay.

**Done when:** at 150 ms of round trip, the own tank moves on the frame after the key, a shell
leaves the barrel on the frame after the press, and in 10 minutes against bots no predicted shell
is ever drawn hitting a tank the server says it missed.

## Block C3 — The netcode made visible

_2 days. This is what a stranger opens the demo to see._

- [ ] **The server ghost**: a toggle that draws, over the own predicted tank, an outline where the
      server last said it was, and over every remote tank where its newest snapshot puts it — the
      prediction ahead, the interpolation behind, both on screen.
- [ ] **The overlay**: round trip and jitter, the interpolation delay and the buffer's depth,
      unacknowledged inputs, corrections per second and their size, bytes per second each way,
      the tick. A graph of the last ten seconds.
- [ ] **The network lab**, per connection on the server as in the earlier projects — so a dropped
      reply or a stall is real, and a live demo's lab breaks only the visitor's own link: add
      latency, add jitter, stall for 2 s, drop the socket. Prediction and interpolation switchable
      off, so the difference is felt, not explained.
- [ ] **The kill replay**: on death, the last 3 seconds from the client's own snapshot history,
      slowed, with the shell's path and its bounce drawn — the server's truth, not the prediction.
- [ ] A short "how this works" panel linking the ADRs.

**Done when:** a stranger can turn on the ghost, add 300 ms in the lab, switch prediction off and
on, and see the difference in their own tank in under a minute.

---

# Part III — Hardening & packaging

## Block P0 — Hardening

_2 days._

- [ ] Reconnect: a socket dropped mid-fight resumes the same tank within 10 s with nothing replayed
      twice; after 10 s the tank is gone and the client rejoins as new.
- [ ] A hidden tab: the browser stops its frames and slows its timers, so the client stops sending
      inputs; the server repeats the last one and then idles the tank; the tab back in view snaps
      to the truth and resumes prediction.
- [ ] A slow client: when a socket's `bufferedAmount` grows past a bound, the server skips its
      snapshots (the next is a delta against what it last sent, so nothing breaks) instead of
      queueing them; past a second bound, it closes it.
- [ ] Hostile inputs: an input is a direction and buttons, never a position, so speed is not
      something a client can claim; inputs beyond the queue's bound dropped; a client sending more
      than 2× the tick rate throttled; a resume token for another room refused.
- [ ] `tools/load`: headless clients through `netcode` driven by `bots`' policy over the wire — 20
      rooms of 12 for 30 minutes against a production-mode server with the lab's faults on part
      of them; the tick's p99, bytes per client, corrections per client, reconnects. Results to
      `docs/load/`.

**Done when:** 240 clients for 30 minutes keep every room's tick within its deadline at p99, stay
under the bandwidth budget, and every dropped client that came back within 10 s found its own tank.

## Block P1 — Packaging

_1–2 days._

- [ ] One image, one origin: the server serves the built page beside the socket; `Dockerfile`, CI
      builds and runs it and plays the E2E against it; a Render Blueprint, its free tier's sleep
      and fresh start decided in an ADR as before.
- [ ] Playwright E2E in CI: two browser contexts join one room and each sees the other move; one
      shoots the other dead and both see the kill; the lab's 300 ms in one of them leaves its own
      tank responsive and the other's view smooth; a dropped socket resumes the same tank.
- [ ] README: a GIF above the fold — the ghost on, the lab adding latency, the tank still crisp —
      the five decisions in a paragraph each, the bench and load numbers, "try to break it".
- [ ] `docs/architecture.md`: one tick on the server, one frame on the client, the input's life from
      the key to the acknowledgement, as diagrams.
- [ ] The workspace README's row for this project — and its first line, which still says iGaming.

**Done when:** a stranger can open the live link, play against bots, turn on the ghost, break the
network from the lab, and watch their tank stay under their thumb — in under two minutes.

---

## Open questions — each decided in the block named

- ~~**Phaser 3 or 4**~~ — **decided at S0: Phaser 4** (4.2.1, the stable release on 2026-10-03), pinned in the catalog.
- **Snapshot rate** — 30 Hz is the plan; whether 15 Hz with a longer interpolation delay looks the
  same is measured, not argued. **The bytes were measured at S4:** 15 Hz is 0.93 KB/s against
  1.75 at 30, both far under budget, so the bytes do not argue for it. (C1 decides the look)
- **Tank against tank** — whether pushing is predicted (it is not, in the plan: the own tank stops
  at another as the server says, and the correction is the visible cost). (C0)
- ~~**The interest radius**~~ — **decided at S2:** a square, `viewHalf` = 880 units each side of the
  tank (protocol § 8.3).
- **Gamepad on iOS Safari** — supported or said not to be. (C2)
