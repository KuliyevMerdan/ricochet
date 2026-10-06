# Load — results

Written by `pnpm load` (2026-10-06, Apple M4 Pro, Node v24.14.1). See [README.md](README.md) for what is run and why.

| | |
| --- | --- |
| Clients · rooms · minutes | 240 · 20 · 30 |
| Tick lateness p99 (worst sample) | 1.056 ms |
| Tick work p99 (worst sample) | 3.542 ms — the period is 33.3 ms |
| Down per client, mean · worst | 1.55 · 1.62 KB/s (budget 6) |
| Up per client, mean · worst | 0.26 · 0.27 KB/s |
| Short drops back on their own tank | 400 of 400 — back in 252 ms at p50, 257 at worst |
| Long drops (past the grace) joined again as new | 189 of 189 |
| Reconnects nobody scheduled | none |
| Kills | 34811 |

| Profile | Clients | Corrections a minute | Mean size, units |
| --- | --- | --- | --- |
| clean | 120 | 0.0 | 3.1 |
| lagged | 60 | 0.5 | 9.0 |
| rough | 20 | 4.6 | 12.1 |
| dropper | 40 | 0.1 | 10.6 |

**Done when:** met.
