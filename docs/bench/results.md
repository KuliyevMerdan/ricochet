# Bench results

Written by `pnpm bench` (`tools/bench`) on 2026-10-03 — Apple M4 Pro, 12 cores, Node v24.14.1. Each room is played by bots for 9,000 ticks (5.0 min of play) after 300 to spread out, every tank treated as a connected player. What the numbers mean, and the decisions taken from them, is in [README.md](README.md).

## The tick

Milliseconds of one server tick: `sim.step`, then a view, a diff and an encode per player. The bots' decisions are timed apart — a room with people in it has fewer.

| Tanks | tick p50 | tick p99 | tick max | of which `step` p99 | bots p50 | bots p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | 0.019 | **0.083** | 0.770 | 0.039 | 0.034 | 0.202 |
| 12 | 0.041 | **0.112** | 0.494 | 0.052 | 0.070 | 0.308 |
| 24 | 0.107 | **0.354** | 1.112 | 0.120 | 0.108 | 0.410 |

## Down, per client

KB/s (1 KB = 1,000 bytes) sent to one client — snapshots and the roster, each with its WebSocket header — as the mean over clients / the worst client.

| Tanks | delta, 30 Hz | whole, 30 Hz | delta, 15 Hz | deflated alone | deflated in context |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | **1.30** / 1.34 | 3.34 / 3.57 | 0.68 / 0.70 | 90 % | 50 % |
| 12 | **1.67** / 1.75 | 4.33 / 4.68 | 0.89 / 0.93 | 93 % | 56 % |
| 24 | **2.92** / 3.05 | 7.53 / 8.02 | 1.57 / 1.65 | 97 % | 64 % |

"Deflated" is the size of a sampled delta frame after `deflateRaw`, against its raw size: alone (permessage-deflate with `no_context_takeover`), and with the socket's previous 8 KB as the dictionary (a shortened stand-in for context takeover's 32 KB window).
