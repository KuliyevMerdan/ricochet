# The bench

`pnpm bench` (`tools/bench`) plays rooms of 6, 12 and 24 bots headless, with no server and no
sockets, for five minutes of game time each, as fast as they go. Every tank is treated as a
connected player: each tick it gets a view, a diff against the last view sent to it, and an
encoded frame. The numbers are in [results.md](results.md), rewritten on every run. The command
fails if a 12-tank tick reaches 1 ms at p99, or any client of 12 is sent 6 KB/s with deltas
(ROADMAP S4's done-when).

**Measured 2026-10-03, one laptop (Apple M4 Pro, Node 24):**

| 12 tanks | |
| --- | --- |
| a server tick — `step`, 12 views, 12 diffs, 12 encodes — p99 | **0.11 ms** of the 33 ms period |
| 12 bots deciding, p99 | 0.31 ms |
| down to a client with deltas, worst of the 12 | **1.75 KB/s** of the 6 KB/s budget |
| the same, every snapshot sent whole | 4.68 KB/s |
| deltas at 15 Hz instead of 30 | 0.93 KB/s |

## What it measures, and what it does not

- **The tick is computation only.** It times what the server computes per tick, not what it sends.
  S3's soak, with 12 clients on real sockets in the same process, measured a tick's work at
  3.0 ms p99. Almost all of the difference is `ws.send` and the clients' own JavaScript. A server
  whose clients are on other machines is P0's load test.
- **The bots are timed separately.** A room seats bots only while it has fewer than six people, so
  a full room runs none. Where they run, their decisions cost about three times the tick: the
  distance fields over the grid, and the bank-shot search when they are ready to fire.
- **Bytes include all the framing:** every snapshot and every roster, each with its 2- or 4-byte
  WebSocket header. A bot-only room is a busy one: everyone fights, every tick.

## What was decided from it

- **The budget holds with room to spare.** 1.75 KB/s against 6 KB/s, and 24 tanks, twice a room,
  still fit at 3.05 KB/s. Deltas take a snapshot to 37 % of its whole size. Shells sent once as
  starting conditions (protocol § 5.3) are why a busy room costs little more than a quiet one.
- **15 Hz halves the bytes**: 0.93 KB/s against 1.75. Whether it *looks* the same, with a longer
  interpolation delay, is C1's question. The bytes no longer argue for it: 30 Hz is already a third
  of the budget.
- **No compression** (protocol § 9). Deflated on its own, as permessage-deflate with
  `no_context_takeover` sends it, a delta frame keeps 93 % of its size; the frames are already
  dense. With the socket's history as the dictionary (context takeover), 56 %. But that costs a
  zlib context per socket in memory and CPU on every frame, to save under 1 KB/s that the budget
  does not need.
