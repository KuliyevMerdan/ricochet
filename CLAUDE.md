# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project status

> ✅ **Every block has landed: the game plays in a browser, shows its netcode, holds 240 players, and is live.**
> **S0 landed 2026-10-03**: the pnpm + Turborepo workspace of ten units, strict TypeScript with no DOM and no Node unless a unit opts in,
> the dependency graph as dependency-cruiser allow-lists, purity and exactness as ESLint rules — all
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
> sent. **S4 landed 2026-10-03**: `bots`, which play from a player's view through a player's
> inputs and fill a room to 6, and the bench: a 12-tank tick 0.11 ms at p99, 1.75 KB/s down to the
> busiest client against a 6 KB/s budget. **C0 landed 2026-10-05**: `netcode` — the client with no
> DOM: the handshake and reconnects, the server's clock from pongs, the own tank predicted through
> `stepTank` and reconciled with every snapshot, everyone else interpolated behind an adaptive
> delay; ten virtual minutes at 150 ± 40 ms against the real `sim`, the prediction the server's to
> the bit in all 17,750 ticks no other tank could have touched. On the way the server stopped
> inventing a late input (protocol D15). **C1 landed 2026-10-05**: the page — Vite, one Phaser 4
> game drawing `netcode.frame(now)` at the display's rate, a DOM layer for the name, the
> connection and the scoreboard; the arena from textures generated at boot into one atlas, pooled
> sprites, particles and synthesised sounds. On a phone profile with the CPU throttled 4×, twelve
> tanks and thirty-six shells drew at the display's rate with 2 ms of work a frame at p99; ten
> minutes of play left the heap flat; a hidden tab drew nothing. `sim`'s pinned run gave the same
> hash in Chromium and WebKit, and CI replays it in Firefox too. **C2 landed 2026-10-06**: feel —
> keyboard and mouse, two touch sticks and a gamepad behind one `intent()`; the own shells predicted
> at the press, adopted by the server's by `seq`, fizzled when refused; hits, kills and spawns only
> from the server's events; the death screen, the kill feed, settings remembered. At 150 ms a key
> and a press each show on the next frame, and in ten minutes against bots all 649 hits drawn were
> the server's. The server's fast-forward now counts the input's wait in its queue (protocol D16).
> **C3 landed 2026-10-06**: the netcode made visible — the server ghost over every tank, an overlay
> with a graph of the last ten seconds, a network lab that delays, jitters, stalls and drops the
> visitor's own link on the server's side of the socket (protocol D17), the prediction and the
> interpolation switchable off, and a kill replay from the snapshots held, the fatal shell traced
> off its wall by `sim.fly`. Through the page's DOM, a stranger's steps took 14 s; at 300 ms a key
> moved the own tank on the next frame with the prediction on and after 43 frames with it off.
> **P0 landed 2026-10-06**: hardening — a client that gives up a silent socket and takes its tank
> back, a hidden page that sends nothing and snaps back to the truth, a slow socket's snapshots
> skipped and then the socket closed (protocol D18), floods ignored or refused, and `tools/load`:
> 240 headless clients on `netcode`, played by the bots, half of them on the lab's faults, against a
> production-mode server for 30 minutes — the tick 1.06 ms late and 3.5 ms of work at p99, 1.6 KB/s
> to the busiest client, every short drop back on its own tank and every long one joined as new.
> **P1 landed 2026-10-06**: packaging — one image serving the page beside the socket from one
> origin, deployed to Render's free tier from a Blueprint once CI passes (ADR-0004); Playwright in
> CI — two players who see, chase and kill each other through the lab and a drop, and a stranger's
> two minutes against the local server and against the image; the README's GIF and
> `docs/architecture.md`'s three diagrams. The live demo is <https://ricochet-demo.onrender.com/>; the stranger
> passed against it 3 of 3, in 4.9–5.6 s, the drop resumed through Render's proxy.
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
   tank and replays them. A visible correction is smoothed away as a decaying offset, never snapped
   — a respawn excepted. A late input costs no correction: the server stands a tank with no input
   (protocol D15), and a tick of standing changes nothing the prediction counted on.
3. **Everyone else is interpolated** ~100 ms in the past, between two snapshots that both exist. The
   delay adapts to the link's jitter.
4. **Shells are fast-forwarded, not targets rewound**
   ([ADR-0002](docs/adr/ADR-0002-shells-fast-forwarded.md)). A shell fired by your input starts
   on the server moved forward by your half round trip and your input's wait in its queue (protocol
   D16), capped at 100 ms — where your prediction drew it, in the server's present. Hits are decided
   only on the server, at its own present, and shown only from its events.
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
of it. Enforced by lint since S0 (§ Purity and exactness), and measured since C1: the soak's pinned
5,000-tick run ends in the same world in Chromium, Firefox and WebKit (`pnpm e2e`).

### Packages

All ten exist since **S0**, and all ten are written. The right-hand column is the block that fills each.

| Package | Responsibility | Block |
| --- | --- | --- |
| `packages/geom` | the world's grid — integers in **eighths** of a unit (`ARENA_EIGHTHS`, `eighths`, `roundHalfAway`); the 1,024-direction table (`COS`, `SIN`, ×2^14), printed by [`golden/directions.py`](packages/geom/golden/directions.py) from one octant and its symmetries, so `reflect` off a face is exact on the index *and* the vector; `step(d, speed)`, `turnToward`, and `nearestDir` — a mouse offset to a direction by cross products, no `atan2`; `circleOverlapsBox` by squared distances; `sweep` — a moving circle against a box grown by its radius, every time a fraction of integers and every comparison a cross-multiplication, returning the first contact and the face it met. Pure and exact | ✅ S1 |
| `packages/protocol` | the binary wire ([`docs/protocol.md`](docs/protocol.md)): `encodeClient` / `decodeClient`, `encodeServer` / `decodeServer` over `DataView`, little-endian — a read past the end sets a flag instead of throwing, and a frame is refused as a value for truncation, trailing bytes, a reserved bit or a field out of range; `diff(base, next)` and `apply(base, snapshot)` between per-client **views** — tanks by field mask with small `i8` steps, shells once as starting conditions — `apply` refusing a delta not of its base; strict hand-written UTF-8 and `validName`; `RULES`, the game's numbers, here because the bots play by them; the network lab's `lab` and `stall` and their `LAB_LIMITS` (C3, D17). Pure | ✅ S1 · C3 |
| `packages/sim` | the room, one tick at a time: `step(world, commands) → { world, events }` — timers and respawn, driving, firing, flight, crates, in that order ([`docs/protocol.md`](docs/protocol.md) § 8.1); `createWorld`, `join`, `leave`. `stepTank(tank, command, arena, obstacles)` — **the prediction's entry point**, the hull turning or reversing toward the stick and the move taken along x then y as far as it is free; `stepShell` — a shell's flight with no tanks, what a client runs on the shells it holds; `fly` / `flyTick` with tanks, sparing the owner until the bounce. `view(world, viewer, events, ack)` — **the one door to the wire**: a square of `viewHalf`, the viewer's timers, events filtered by § 6. A world is plain data — integers, booleans, arrays — and its randomness a mulberry32 state inside it. Returns events; never emits. Pure and exact | ✅ S2 |
| `packages/bots` | `decide(view, memory) → { input, memory }` — a bot is handed the view a player in its seat holds and answers with a player's input; its memory goes back to the caller, so it is replayable. `createBot(id, arena, seed, skill)`; `SKILLS` — `spread`, the deliberate aim error in directions (12 / 24 / 40), and whether it banks. Targets the nearest tank it can hurt, a crate at its last hit point, else wanders. `nav.ts`: a 32-unit grid built once per arena (`gridOf`, in a `WeakMap`), Dijkstra distance fields shared between bots (`fieldTo`), `waypoint` — the furthest cell down the field it can drive straight to, 4 units clear of walls. `aim.ts`: `ahead` — where a target will be when the shell arrives, the firing tick included (§ 8.1); `trace` — a shell's two legs flown with `geom` as the server flies them; `shotAt` — straight, else off the wall face whose reflection lands it, clear of its own tank. Pure, not exact: an input may be computed with `atan2` | ✅ S4 |
| `packages/netcode` | `Client` — **no DOM**: a `Connect` (opens a socket, reports `open` / `message` / `close`), a `Clock` and `Timers` are handed in, so the page, the load tool and the tests run the same code. The handshake and the states as a stream (`onState`: `connecting`, `joining`, `live`, `reconnecting`, `outdated`, `refused`, `closed`); every frame decoded, an unreadable one `outdated`, a snapshot not of its base a fresh socket at once; a dropped socket retried with the token, 250 ms doubling to 4 s; a socket silent for 6 s — a half-open link — given up on the same way (P0). `setHidden` — a hidden page sends no inputs and keeps no effects; shown, it snaps to the truth: the correction dropped, the events of the time away not replayed, the inputs afresh (P0). `ServerClock` — pongs, the shortest round trip of the last six believed, slewed at 5 % (jumped past 10 ticks); `latest()`, the newest pong's. Inputs one a client tick on the server's clock plus a lead, sampled from `intent`, sent, predicted and kept; past a round trip — the newest as well as the least — and a full queue unacknowledged they stop; the lead drops a tick when even the quickest of five seconds' inputs waited 3 ticks on the server. `Prediction` — `stepTank` on every input, the acknowledged dropped and the rest replayed from each snapshot's tank, stopping at other tanks where they will be (`Mover`: the last step carried on, one further for a lower id); a correction an offset decaying with a 33 ms time constant, a respawn drawn at once. `Timeline` — views by tick, three seconds kept; the others drawn at the server's clock less the link's least lateness less a delay of 2 ticks plus the 95th percentile of the rest, 2–12; the drawn time never backward, never past a tick beyond the newest view. `frame(now)` — the own tank drawn from its newest predicted tick toward the one the intent now would make (`peek`), plus the offset; the others between two views, or a tick past the newest along their last step; their shells flown from their starting conditions with `stepShell`, a fraction of a tick by `fly`; crates; `effects`. **The own gun** (C2): `gunStep` — the timers, then the trigger, as `sim.step` runs them — replayed with the tank, the shells in the air counted by their flight (`OwnShells.aliveAt`, at the tick before, since a tick fires before its shells fly). `OwnShells` — a shot fired at the press (`peek`) or the send, born at the predicted muzzle, flown in the server's **present** and eased back by what the fast-forward's cap leaves over; adopted by its `shot` event's `seq` under the same drawn id (−seq), the step decaying; fizzled when acknowledged with no `shot`; ended by its own flight at its second wall or age, kept counted until the snapshots reach that end; a `hit` on it shown on arrival. `Happenings` — the server's hits, kills, spawns and crates as effects when the drawn time reaches their tick, the others' shells' ends by their flight; never a hit inferred. `onEvents` — every snapshot's events, for the kill feed and the death screen; `stats().shots`. **Made visible** (C3): `frame().ghosts` — every tank where the newest view puts it; `modes` — the prediction off draws the own tank and its shells from the views like everyone else's (the prediction running on underneath, `OwnShells`' effects dropped and `Happenings` showing the own shots, hits and ends), the interpolation off draws everyone at the newest view; `lab(faults)`, sent now and after every `welcome`, five quick pings on a change; `stall(ms)`; `drop()` — this end let go, the token taking the tank back; `stats()` — the newest round trip, the jitter (`Timeline.jitter`, the 95th percentile of lateness past the least), the delay, the buffer's depth (`Timeline.ahead`), the tick, corrections — a respawn not among them — and how far they moved the tank. `Replay` (`replay.ts`) — the last three seconds before the own tank's death from the views held: tanks between views, shells flown from their starting conditions, `at(tick)`; the fatal shell's path with its bounce and its hit, each the least distance at which `sim.fly` bounces or reaches the tank | ✅ C0 · C2 · C3 · P0 |
| `packages/renderer` | the arena in Phaser 4, handed a `Picture` a frame — its own types, eighths and 1,024ths, **no protocol**: it draws pictures. `mountArena(parent, arena, picture)` → `ArenaView` (`pointerFromMe`, `stats`, `destroy`): one WebGL game, the canvas at up to 2 device pixels per CSS pixel, its loop asleep while the tab is hidden. `ArenaScene` — the floor as the clear colour and a grid of lines, the walls one Graphics, crates; tanks a hull and a turret tinted by id (`palette.tint`, twelve hues) with a ring for the shield and the own tank, pooled by id; shells pooled; three particle emitters (muzzle, sparks, bursts) with hard caps; the camera on the own tank at `zoomFor` — at most 640 units from its centre — easing an 80-unit lead toward the aim (`CameraRig`); the minimap on a second camera that neither scrolls nor zooms. `buildAtlas` — every frame drawn once with a Graphics into one `DynamicTexture` at twice world size. `ShellWatch` — the others' muzzle flashes and every ricochet found by comparing pictures, records reused; the own shots, hits, kills, spawns and ends are the picture's `effects`, drawn as sparks, bursts, a white flash on the tank hit and the turret's recoil. `Sounds` — shot, ricochet and hit synthesised into Phaser's audio cache, fainter with distance, six at most, muted by the setting. The server ghost (C3): the picture's `ghosts` drawn as a hull's footprint and a turret in outline, white for the own tank and in their colours for the others, pooled by id | ✅ C1 · C2 · C3 |
| `apps/server` | Fastify for `/health` and `/ready` (the tick's lateness and work at p99 among its numbers); `ws` for the game at `/play`; the built page from `/` when `RICOCHET_STATIC_DIR` names it (P1,
ADR-0004) — hashed assets cached for a year, `index.html` never, a directory without one refusing to
boot. `Ticker` — one drift-free 30 Hz loop for every room, deadlines from the first tick, sleeping to just short of each and spinning the rest on `setImmediate`. `Room` — a world, its players' input queues (one a tick in `seq` order; a tick with none stands the tank — protocol D15), a snapshot a tick to each player diffed against the last sent on its socket — skipped for a socket with 16 KB unsent, its events carried to the next, the socket closed past 64 KB (protocol D18, P0) — the roster, the resume grace, the fast-forward `lead` from the socket's round trip and the input's wait in the queue (protocol D16); its bots — players with no socket, each deciding from `sim.view` every tick, filled to `botsFillTo` (`RICOCHET_BOTS`), the newest leaving as a person arrives. `Lobby` — the fullest room with a seat, by people not tanks, `FULL` past the limit, tokens, idle rooms closed. `Connection` — one socket's protocol: `hello` first, refusals as `VERSION` / `NAME` / `MALFORMED` / `RATE`, `pong`s; past twenty a second, pings and the lab's frames ignored. `sockets.ts` — the `ws` wiring and the WebSocket-level pings that measure each socket's round trip, each carrying its id; a socket dead after 10 s unanswered. **The network lab** (C3, `RICOCHET_LAB` — on in development): `Link` (`link.ts`), two `Lane`s per socket that delay a frame by half the latency and a fresh draw of the jitter, never past the frame ahead, and shut through a stall — one timer draining the queue from its head, a clean link delivering at once; a socket's frames, its pings and their answers all run through it, so the server's own round trip sees the lab; `Connection` hands `lab` and `stall` to its own socket's link only. `Room`, `Lobby` and `Connection` know no socket | ✅ S3 · S4 · C3 · P0 · P1 |
| `apps/web` | Vite (`vite.config.ts` proxies `/play` to the server; `RICOCHET_SERVER`), `index.html` and `main.ts`: the name (`ui.askName`, `validName`, remembered), a `netcode` client on the page's own origin (`socket.ts` — the browser's `WebSocket`, `performance.now`, `setTimeout`), `Controls` (`input/`) — three schemes behind one `intent()` and `peek()`, whichever was touched last driving: `KeyboardMouse` (WASD or the arrows, the aim from the own tank to the pointer, click or Space — a press latched until an input carries it), `TouchSticks` (two floating thumb sticks, shown once the screen is touched; the aim stick fires past 55 % of its travel), `Pad` (the standard mapping: sticks, A or the right bumper or trigger) — and the arena mounted with a picture from `client.frame(now)` each frame; the DOM over the canvas: the connection's state, `outdated`'s reload, the scoreboard's top five and the own place, the kill feed and the death screen (`hud.ts`), the settings — sound, the sticks' size and side, a small network overlay — remembered (`settings.ts`). `?stress` draws C1's worst case with no server (`stress.ts`); `scripts/perf.mjs` measures it (`docs/perf/`). `scripts/feel.mjs` measures C2's done-when behind a 150 ms proxy. **C3:** the network lab's panel (`lab.ts`) — the ghost, the prediction, the interpolation, the overlay, the added latency and jitter as presets, the stall, the drop, the "how this works" panel linking the ADRs; nothing of it remembered, so a visit starts on a clean link. The overlay (`hud.ts`) — the round trip and jitter, the interpolation delay and buffer, the inputs ahead and the lead, corrections a second and their size, bytes each way, the tick — and its graph of the last ten seconds (`graph.ts`). The kill replay (`replay.ts`, `framing.ts`) — `netcode`'s `Replay` on a canvas of its own at half speed, framed on the death, the killer and the fatal shell's path, the path drawn as it flies, outliving the respawn. `scripts/lab.mjs` measures C3's done-when through the DOM. The page's visibility goes to `client.setHidden` (P0). `window.__ricochet` holds the view, the client and the last picture for the scripts | ✅ C1 · C2 · C3 |
| `tools/bench` | `BotRoom` — a room of bots on `sim` with no server; `bench` — the server's tick (`step`, then a view, a diff and an encode per tank) and the bots timed apart, at p50 / p99; bytes down per client with framing and roster, delta and whole, 30 Hz and 15, deflated alone and in context. `pnpm bench` runs 6, 12 and 24 tanks, writes [`docs/bench/results.md`](docs/bench/results.md), and fails over budget | ✅ S4 |
| `tools/load` | headless clients over the wire (P0): `LoadPlayer` — a `netcode` client on a `ws` socket, played by `bots`' policy from the views it holds (`BotDriver`, a fresh memory for a new tank), asking for a picture ten times a second; its link made worse through the server's own lab by its `Profile` — clean, lagged (150 ± 40 ms), rough (300 ± 100 ms, a 2 s stall every 90 s), dropping (a drop every 2 min, every third kept out 13 s, past the grace) — each drop followed to the welcome that ends it. `pnpm load` (`main.ts`) starts the built server in production mode with the lab on and no bots, joins 20 rooms of 12 one at a time over worker threads, samples `/ready` every 30 s, and `summarise`s the run against the done-when into [`docs/load/results.md`](docs/load/results.md) | ✅ P0 |

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
| Golden | every message written by hand beside its bytes, also written by hand from the document — both directions held to them, every truncation and a trailing byte refused, no client frame taken for a server one; 30 frames one field from valid, each refused with its reason; the direction table rerun from its script (`tests/golden-fresh.test.ts`); the document's message, event, error and rules tables held to the code (`tests/protocol-doc.test.ts`) | ✅ S1 |
| Geometry | the table exactly symmetric, on the unit circle within rounding, turning steadily; a mirrored direction's step the mirrored step at every speed to 320; 10⁶ random shots, radii to 8 units, speeds to twice a shell's, walls from 16 units thick — each sweep meeting the wall on its grown boundary, no later than a 64-point sampling of the move | ✅ S1 |
| Codec | 100,000 random messages each way decode to themselves; 20,000 ticks of a moving world through `diff`, the bytes and `apply` arrive as the server's view, under 200 bytes a tick | ✅ S1 |
| World | every rule on staged worlds (23); arena 0's edges, walls apart, spawns and crates clear and reachable; 100,000 random ticks of 12 tanks with players coming and going — no tank in a wall or another tank, no shell in a wall or off the arena, hit points and scores what the events say, every tenth tick every view across the wire; 0 mismatches in 200,000 ticks of `stepTank` replays where no other tank came near; the same seed the same world, and 5,000 ticks pinned to a hash | ✅ S2 |
| Server | the ticker against a hand-moved clock — deadlines from the first tick under 7 ms of work a tick, a stall caught up, a pause rebased; a room's queues, acks, a tank standing through a late input, the fast-forward, the grace, the roster; the lobby's filling, `FULL`, resume and expiry; a connection's refusals and pongs; bots filling a room and leaving as people come, back when a grace runs out, driving and firing · 12 clients on real sockets, with bots until the sixth arrives (`server.test.ts`, ten seconds in CI, `soak` five minutes): every client's view the server's at every tick, every view the world as it stands, tick lateness p99 under 2 ms · the lab (C3): a lane on a clean link at once, a frame its one-way delay, jitter bunching and never reordering, order kept past a late timer, a stall holding everything then delivering it in order, nothing once closed; `lab` and `stall` handed to the sender's own link, and to none on a server without one · over real sockets (`lab.test.ts`): 300 ms on one socket and not its neighbour's, the server's own round trip measuring it; a 1 s stall, then every snapshot once, in order; a server without the lab hearing nothing · P0 (`hostile.test.ts`): a hundred inputs a tick moving a tank one step a tick, the queue never past its bound; `RATE` past twice the tick rate, pings past twenty a second unanswered; a forged, outlived or closed room's token leading to no one's tank; a slow socket skipped — the next snapshot a clean delta of the last sent, carrying the kill and the shot between — and closed past the second bound, its tank waiting out the grace | ✅ S3 · C3 · P0 |
| Bots | the grid open at every spawn and crate and in one piece; a straight-driven point following waypoints from every spawn to every crate and spawn, never touching a wall; lead, the straight shot, the bank shot round a post and none without leave; `decide` firing within its spread, holding fire while reloading, shielded or out of shells, circling, going for a crate, wandering, working loose, pure · in 10 minutes of a bot-only room every bot scores and every bot dies, under a quarter of deaths self-inflicted (`tools/bench`) | ✅ S4 |
| Bench | `pnpm bench`: a 12-tank tick 0.112 ms at p99 (under 1 ms) and 1.75 KB/s to the busiest client (under 6 KB/s) on one laptop — [`docs/bench/`](docs/bench/README.md) | ✅ S4 |
| Netcode | the clock — the quickest pong believed, slewed and never backward, jumped past ten ticks; the prediction — only the unacknowledged replayed, a correction decaying, a respawn snapped, another tank met where it will be; the timeline's delay, its hold through a stall and catch-up; the client's states — hello, welcome, a resumed socket with its token and `seq` from 1, a snapshot not of its base, `VERSION` / `MALFORMED` / an unreadable frame, `NAME`, `FULL`, `RATE` · against a server stepping the real `sim` in virtual time, through a link that delays, jitters and stalls as TCP does (`netcode.test.ts`): 10 minutes at 150 ± 40 ms — the prediction the server's to the bit in all 17,750 ticks no other tank could touch, within one unit in 194 of 195 where one could, every respawn snapped, 35,981 frames none drawn from a snapshot not held; two 1 s stalls — every input applied once at most, in order, exact again in 3 s; a clock 50 ms a minute fast and slow — within a tick of the server's, no input dropped; protocol D15 against D14 · C2 (`shots.test.ts`, the same ten minutes): `gunStep`; a shot fired at once, adopted under its id with the step decaying, fizzled when refused, passing through a tank until the server's hit, ended by its own flight and not taken on again, counted in the air past its drawing; `Happenings` at the drawn time — every hit drawn one the server sent and every one it sent drawn (234 of 234, each once), the own shots fired, adopted (over 85 %) and fizzled only where the server refused, the step at adoption under 8 units on average; protocol D16 against ADR-0002 alone · C3: the lab sent after every welcome and not before, a clean link not at all, the stall, the drop onto the same tank; the ghost, the prediction off and the interpolation off drawn from the views, the prediction exact again when switched back on; the timeline's jitter and buffer between frames; the clock's newest round trip · P0: a socket silent for six seconds given up on and the tank taken back with the token; a hidden page sending no inputs, keeping no effects and its socket, and starting afresh when shown · the kill replay against the real `sim` (`replay.test.ts`): a shell off the west wall into a tank — the bounce on the wall's grown face, the hit on the reach's edge within two eighths in the tick of the death, the shell drawn on its path every quarter tick through the bounce and gone after the hit | ✅ C0 · C2 · C3 |
| Browser | the camera's zoom and frame-rate-independent lead, the palette, `ShellWatch`'s effects and reuse; the keyboard's stick, the scoreboard's places, the stress picture · `pnpm --filter @ricochet/web perf` ([`docs/perf/`](docs/perf/README.md)): on a 375 × 812 phone profile, the CPU throttled 4×, 12 tanks and 36 shells at 120 Hz with 0 frames over 25 ms and 2.0 ms of loop work at p99; 10 minutes live, 72,095 frames, none over 25 ms, the heap 7.4 → 7.6 MB; hidden, 0 frames · `pnpm e2e` (`e2e/determinism.spec.ts`): the soak's pinned run, bundled for a page, ends in hash `68b4d373` in Chromium, Firefox and WebKit (Firefox in CI) · the sticks' dead zone and push, the settings parsed field by field, the kill feed's names · `pnpm --filter @ricochet/web feel` ([`docs/perf/`](docs/perf/README.md)) behind a 150 ms proxy: a key and a press each drawn on the next frame, 20 of 20; touch and a gamepad drive and fire; 10 minutes against bots, 649 hits drawn, each the server's, 922 own shells ended each at a hit, a wall, its age or a refusal · the graph's ten seconds and scales, the lab's presets, the replay's half speed and framing · `pnpm --filter @ricochet/web lab` ([`docs/perf/`](docs/perf/README.md)), through the DOM alone: a stranger's steps in 14 s; at 300 ms a key on the next frame predicted, after 43–44 at 120 Hz not; a 2 s stall, a drop back onto the same tank in 266 ms, a death's replay traced to the tank | ✅ C1 · C2 · C3 |
| Load | `BotDriver`, the room's mix, `summarise` passing and failing the done-when · `pnpm load` ([`docs/load/`](docs/load/README.md)): 240 clients in 20 rooms for 30 minutes against a production-mode server, half on the lab's faults — the tick 1.06 ms late and 3.54 ms of work at p99, 1.62 KB/s down to the busiest client, 400 of 400 short drops back on their own tank in 257 ms at worst, 189 of 189 long ones joined again as new, no reconnect nobody scheduled | ✅ P0 |
| E2E | Playwright against the built server serving the built page (`pnpm e2e`): `duel.spec.ts` — two browsers on a server with no bots, each seeing the other move, one driving round the walls by the bots' distance field and shooting the other dead with a gamepad, both seeing the kill, the death screen and its replay; 300 ms from the lab on one, its own tank moving on the next frame and its motion on the other's screen never past half again its speed; a drop back onto the same tank · `stranger.spec.ts` — P1's done-when through the page: bots, the ghost, 300 ms, a key on the next frame predicted and a round trip later not, a drop, in under two minutes; run again by CI's `image` job against the Docker image (`pnpm e2e:live`) | ✅ P1 |

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
| `pnpm test` | each unit's own `src/**/*.test.ts` (`config/vitest.package.ts`), **one unit at a time** (`--concurrency=1`): the server's socket test measures tick lateness, and beside the CPU-bound suites on CI's four vCPUs it starved to 153 ms at p99 |
| `pnpm test:root` | `tests/` — the rules proven against `config/fixtures/`, the direction table held to its generator (needs `python3`, standard library only), and the protocol document held to the code |
| `pnpm format` | Prettier. Markdown is excluded: the canon is hand-wrapped |
| `pnpm bench` | `tools/bench`: rooms of 6, 12 and 24 bots, five minutes each — rewrites `docs/bench/results.md`; fails over S4's budget. Not in `check`: it measures the machine (`--ticks N` for another length) |
| `pnpm load` | `tools/load`: P0's done-when — 240 clients in 20 rooms for 30 minutes against the built server (production mode, the lab on, port 8096); rewrites `docs/load/results.md`, fails when the done-when is not (`--rooms`, `--minutes`, `--workers`, `--url` for a server already running). Not in `check`: it measures the machine |
| `pnpm dev` | the server (tsx watch, :8080) and the page (Vite, :5173, `/play` proxied to the server), the workspace built first |
| `pnpm e2e` | Playwright (`e2e/`): the soak's pinned run in Chromium, Firefox and WebKit; the duel and the stranger in Chromium against the built server serving the built page (ports 8191, 8192). CI's `engines` job, beside `check` |
| `pnpm e2e:live` | the stranger alone against `E2E_BASE_URL` — the image in CI's `image` job, or the live demo |
| `pnpm --filter @ricochet/web feel` | C2's done-when behind a proxy holding 75 ms each way (`RICOCHET_FEEL_ONE_WAY_MS`): frames from a key and a press, the three schemes, ten minutes against bots (`RICOCHET_FEEL_MINUTES`); needs `pnpm build` |
| `pnpm --filter @ricochet/web lab` | C3's done-when: the built page and server (`RICOCHET_LAB=on`, six bots), Chromium driving the page through its DOM — the ghost, 300 ms, the prediction off and on, a stall, a drop, a death's replay; needs `pnpm build` |
| `pnpm --filter @ricochet/web perf` | C1's done-when in a throttled phone profile — stress, hidden, ten live minutes (`RICOCHET_PERF_MINUTES`); needs `pnpm build`. Not in `check`: it measures the machine |

The server on its own: `pnpm --filter @ricochet/server dev` (tsx watch, port 8080; `PORT`,
`HOST`, `RICOCHET_MAX_ROOMS`, `RICOCHET_PING_MS`, `RICOCHET_BOTS` — a room's bot fill, 0 for none —
`RICOCHET_LAB` — the network lab, `on` or `off`, on by default in development — `RICOCHET_STATIC_DIR`
— the built page to serve from `/` — `LOG_LEVEL`). The image: `docker build -t ricochet .`, then
`docker run -p 8080:8080 -e RICOCHET_LAB=on ricochet`. `pnpm --filter @ricochet/server
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

- **Gamepad on iOS Safari.** The pad is read through the Gamepad API's standard mapping, which
  Safari has supported since iOS 13 for the controllers Apple lists — and it was tested here only
  as a stand-in pad in Chromium. P1's real device says whether it works, or the README says it
  does not.
- **A real phone.** C1's frames were measured in a phone's profile on a desktop GPU, and bounded
  below on SwiftShader (62 fps in the stress run, 8 of 1,244 frames over 25 ms) — a phone's GPU lies
  between the two. P1's live demo is measured on a real device.
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
