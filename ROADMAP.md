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

---

## The game, in one screen

- **The room.** Up to 12 tanks on a 2,048 × 2,048 arena of walls and cover, bigger than the screen:
  the camera follows you, a minimap shows the walls and you. Bots fill a room to 6 and leave as
  people arrive, so the demo is never empty. Join at any moment; there is no lobby and no round to
  wait for.
- **A tank.** 3 hit points. The hull turns toward the stick at a limited rate and drives at 220
  units/s; the turret aims independently. One shell per 350 ms, at most 3 of yours in the air.
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
   snapshots are deltas against the last one the client acknowledged; each client is sent only what
   lies within its view.

And the client makes all of this **visible**: a ghost of the server's truth over your own predicted
tank, the snapshot buffer, corrections per second, bytes per second — and a network lab that breaks
only your own connection.

---

## Task map

| Block | Delivers | Gates on | Status |
| --- | --- | --- | --- |
| **S0** | Workspace, strict TS, boundary lint, purity tests, CI, `CLAUDE.md` | — | ✅ (landed 2026-10-03) |
| **S1** | `protocol` · `geom` — the binary wire, quantisation, the direction table, the contract and ADRs | S0 | ☐ |
| **S2** | `sim` — the world step: tanks, shells, ricochets, damage, respawn, the arena; pure and headless | S1 | ☐ |
| **S3** | `apps/server` — rooms, the tick loop, input queues, snapshots with interest and deltas, clock sync | S2 | ☐ |
| **S4** | `bots` + `tools/bench` — bots that play through inputs alone; tick cost and bytes per client measured | S2 | ☐ |
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

- [ ] **The wire contract is pinned** in [`docs/protocol.md`](docs/protocol.md): the handshake
      (`hello` with a name and an optional resume token → `welcome` with the room, your entity,
      the rules, the server tick), client → server `input` and `ping`, server → client `snapshot`,
      `event` and `pong`; every field's bytes, the quantisation, the delta rule, the tick and
      snapshot rates, the error taxonomy, and § Rules — every number of "The game, in one screen".
- [ ] **The load-bearing decisions are ADRs** —
      ADR-0001 (the server is the authority; your tank is predicted, the rest interpolated),
      ADR-0002 (shells fast-forwarded by the shooter's half round trip, not targets rewound — and
      why that is right for slow, visible projectiles and wrong for a hitscan rifle),
      ADR-0003 (WebSocket and its head-of-line blocking, over WebTransport or WebRTC data channels —
      what the choice costs, and where it shows in the lab).
- [ ] `packages/geom`: vectors, circles against axis-aligned boxes, a **swept** circle against a box
      (a shell at 20 units a tick must not tunnel through a 16-unit wall), reflection off an
      axis-aligned face. **The direction table**: `cos` and `sin` for 1,024 directions generated
      once by a script, committed as integers, and checked against the script by a test — so aim is
      a table lookup, identical in every engine. Quantisation helpers shared by the codec and `sim`.
- [ ] `packages/protocol`: a hand-written binary codec over `DataView` — one encoder and one decoder
      per message, a version byte, bounds-checked reads that refuse a short or overlong buffer as a
      value, never a throw. Delta encoding of an entity list against a baseline (changed fields by
      bitmask; entities entering and leaving the view). `tests/protocol-doc.test.ts` holds the
      document's message and field tables to the codec.
- [ ] Golden test: a hand-written fixture of every message, encoded to bytes committed beside it;
      decode(encode(x)) = x for 100,000 random messages; every truncation of every fixture refused.

**Done when:** every message round-trips at its pinned size, the direction table matches its
generator, and a swept shell never passes a wall in 10⁶ random shots at every speed up to twice the
pinned one.

## Block S2 — The world step

_3 days. The part reviewers actually read._

- [ ] `packages/sim`: `step(world, inputs, tick) → { world, events }` at a fixed 1/30 s. Tanks
      (hull turn rate, drive, collision with walls and with each other), shells (swept, one
      ricochet, owner and life), damage, death, respawn with the spawn shield, crates, scores. **The
      engine returns events; it never emits.** Randomness (spawn order, crate spot) only from a
      seeded stream carried in the world.
- [ ] **The world is quantised at the end of every tick** to the wire's precision — so a client
      that rewinds to a snapshot and replays its inputs is running the server's own computation,
      not an approximation of it.
- [ ] `stepTank(tank, input, walls)` exported on its own — the prediction's entry point, and the
      same function `step` calls for every tank.
- [ ] `view(world, viewer) → Snapshot` — the one door to the wire: the entities within the viewer's
      interest radius plus a margin, everyone's score, nothing else.
- [ ] The arena as data: walls as boxes, spawn points, crate spots; a test that every spawn point
      sees no wall inside a tank's radius and every crate is reachable.
- [ ] Tests: every rule of § Rules on staged worlds · determinism: the same inputs from the same
      seed give the same world, byte for byte, in Node and in happy-dom · 100,000 ticks of 12
      tanks on random inputs: no tank inside a wall or another tank, no shell through a wall,
      hit points and scores conserved against the events · `fold`: the events of a tick explain
      every change of score and hit points in it.

**Done when:** 100,000 random ticks hold every invariant, and replaying any tank's inputs through
`stepTank` from any of its snapshots reproduces the server's tank exactly whenever no other tank
touched it.

## Block S3 — The server

_2–3 days._

- [ ] `apps/server`: Fastify for `/health`, `/ready` and the page; `ws` for the game. Every inbound
      frame decoded and refused as a value if malformed; a client that sends three is closed.
- [ ] Rooms: join the fullest room with a seat, open a new one when none has; a room with no people
      in it closes after a minute. Names filtered for length and characters.
- [ ] **The tick loop**: a drift-free scheduler (the next tick's deadline computed from the first,
      not from the last), the time each tick took recorded. One room's slow tick must not delay
      another's: a room is a unit of work, not a timer of its own.
- [ ] **Input queues**: one per player, inputs applied one per tick in `seq` order; an empty queue
      repeats the last input; a queue longer than 4 ticks drops its oldest (the client will be
      corrected). The last applied `seq` goes back in every snapshot — the acknowledgement
      prediction replays from.
- [ ] **Snapshots** every tick to every client: `view` for that client, delta-encoded against the
      last snapshot the client acknowledged; a full one when it acknowledged none.
- [ ] Clock sync (`ping`/`pong`): the client learns the server's tick and its round trip; the server
      learns each client's round trip, which ADR-0002's fast-forward reads.
- [ ] Shells fast-forwarded per ADR-0002, capped at 100 ms.
- [ ] A resume token per player: a socket that drops keeps its tank for 10 s.
- [ ] Integration test: 12 headless clients over a real socket with random inputs for 5 minutes —
      every snapshot decoded, every client's view a subset of the world, every acknowledgement
      monotonic.

**Done when:** a room of 12 runs for 5 minutes with every tick on its deadline within 2 ms at p99,
and each client's received snapshots, applied in order, reproduce that client's view of the
server's world at every tick.

## Block S4 — Bots and the bench

_1–2 days. Can run in parallel with S3._

- [ ] `packages/bots`: `decide(snapshot, memory) → input` — steer toward a target or a crate,
      around walls by a coarse grid path found once per arena; aim with lead and a deliberate error
      that is the difficulty; bank a shot off a wall when the straight line is blocked (the
      reflection from `geom`). Sees only its snapshot, acts only by inputs (S0's rule).
- [ ] The server seats bots to fill a room to 6, as players.
- [ ] `tools/bench`: rooms of bots stepped headless as fast as they go — the tick's cost at p50 and
      p99 for 6, 12 and 24 tanks, and the bytes each client would be sent per second, full and
      delta. Results to `docs/bench/`.
- [ ] A test that bots kill each other: in 10 minutes of a bot-only room every bot scores and every
      bot dies — they play, they do not orbit.

**Done when:** `pnpm bench` reports a 12-tank tick under 1 ms at p99 on a laptop and under
**6 KB/s down per client** with deltas, and the numbers are pinned in `docs/bench/`.

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
      snapshots (the next is a delta against what it acknowledged, so nothing breaks) instead of
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
  same at half the bytes is measured, not argued. (S4 measures the bytes, C1 decides the look)
- **Tank against tank** — whether pushing is predicted (it is not, in the plan: the own tank stops
  at another as the server says, and the correction is the visible cost). (C0)
- **The interest radius** — the screen's half-diagonal at the widest aspect allowed, plus a margin a
  shell crosses in the interpolation delay. (S2)
- **Gamepad on iOS Safari** — supported or said not to be. (C2)
