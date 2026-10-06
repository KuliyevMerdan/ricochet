# The load — ROADMAP P0

`pnpm load` ([`tools/load/src/main.ts`](../../tools/load/src/main.ts)) builds the server and the
load tool, starts the built server **in production mode** with its network lab on and no bots
(`NODE_ENV=production RICOCHET_LAB=on RICOCHET_BOTS=0`, port 8096), and joins **240 headless
clients** to it one every 100 ms, so the lobby fills **20 rooms of 12**, each before the next opens.
The clients run on worker threads — half the machine's cores, at most eight — and play for 30
minutes; [`results.md`](results.md) is rewritten at the end, and the run fails when the done-when is
not met.

**A client is a player, over the wire.** Each is `netcode`'s `Client` — the page's own code, with no
DOM — on a `ws` socket, its inputs sampled thirty times a second from `bots`' policy, handed the
views the client holds: the same snapshots a page draws from, so a load client can no more see
through a wall than a person. It asks for a picture ten times a second, as a page's frames would, to
drain its effects and end its shells. It never touches `sim` — the dependency rules forbid it.

**The faults are the lab's**, on the server's side of each client's own socket (protocol § 3.1) —
the ones a visitor can put on themselves. Each room of twelve is mixed:

| Profile | Clients a room | Link | Schedule |
| --- | --- | --- | --- |
| clean | 6 | as it is — loopback | — |
| lagged | 3 | 150 ms ± 40 | — |
| rough | 1 | 300 ms ± 100 | a 2 s stall every 90 s |
| dropper | 2 | 100 ms ± 20 | the socket dropped every 2 min — every third time kept out 13 s, past the 10 s grace |

**A drop is followed to the welcome that ends it.** A short one must come back on its own tank —
`resumed`, the same id; a long one must find its tank gone and join again as new. A reconnect the
schedule did not ask for — a slow socket closed by the server, a link gone silent — is counted by
its reason.

**The server is sampled every 30 s** at `/ready`: the tick's lateness and work at p99 over its last
ten minutes of ticks. The done-when takes the worst sample: the lateness and the work together must
fit inside a tick's 33.3 ms, so every room's tick starts and ends before the next is due. Bytes are
the frames' payloads as `netcode` counts them, without WebSocket framing (two bytes a frame, 60 B/s
down at 30 Hz).

## Results

### 2026-10-06, Apple M4 Pro, Node 24 — six client threads and the server on one machine

| | |
| --- | --- |
| Clients · rooms · minutes | 240 · 20 · 30 — the rooms full throughout |
| Tick lateness, p99 (worst 30 s sample) | **1.06 ms** |
| Tick work, p99 (worst sample) | **3.54 ms** — together a tenth of the 33.3 ms period |
| Down per client, mean · worst | **1.55 · 1.62 KB/s** (budget 6) |
| Up per client | 0.26 KB/s — thirty 9-byte inputs a second, and pings |
| Short drops back on their own tank | **400 of 400**, live again in 252 ms at p50, 257 at worst |
| Long drops — 13 s out, past the 10 s grace | **189 of 189** joined again as new, 15.9 s after the drop |
| Reconnects nobody scheduled | none — no socket closed as slow, none given up as silent |
| Kills | 34,811 |

| Profile | Corrections a minute | Mean size |
| --- | --- | --- |
| clean | 0.03 | 3.1 units |
| lagged, 150 ± 40 ms | 0.5 | 9.0 units |
| rough, 300 ± 100 ms, a 2 s stall every 90 s | 4.6 | 12.1 units |
| dropper, 100 ± 20 ms | 0.1 | 10.6 units |

## What was decided from them

- **The input queue stays at four** (the question left open since C0). On a 150 ± 40 ms link the
  prediction was corrected half a time a minute; at 300 ± 100 ms with a stall every 90 s, under five
  times, about twelve units each. How many of those are the stalls' bursts and how many the jitter
  was not separated; a queue deep enough to hold a 2 s stall's 60 inputs would leave the tank
  acting seconds behind its player, and the numbers ask for no change.
- **The first run failed on six of 197 long drops**, which its summary could not tell apart from
  drops still out when the run stopped — a long drop is 13 s out, and the schedule ran to the last
  second. Nothing was kept to tell which they were. No fault begins in the last 20 s now, so a drop
  not followed to its end is a real failure; the second run had none, and every client's report is
  kept beside the run
  (`ricochet-load-players.json` in the system's temporary directory) for a failure to be looked
  into.
- **A respawn is not a correction.** The client had counted it as one — it moves the drawn tank —
  and the clean clients showed nine corrections a minute, every one a death. Counted apart, the
  corrections are the prediction's errors alone, on the overlay as here.

