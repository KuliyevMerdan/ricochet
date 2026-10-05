# The page's frames — ROADMAP C1

`pnpm build && pnpm --filter @ricochet/web perf` ([`apps/web/scripts/perf.mjs`](../../apps/web/scripts/perf.mjs))
builds the page minified, serves it behind `vite preview` with the built server behind that (bots
filling the room to 12), and opens it in Playwright's Chromium **as a phone**: 375 × 812 CSS pixels,
DPR 3 (the page draws at 2, `mountArena`), touch, and the **CPU throttled 4×** through the DevTools
protocol — checked to slow a busy loop 4.07×. Two clocks per frame: the interval between frames is
the browser's to set; the *work* is the game loop's, from Phaser's `prestep` to its `postrender` on
the main thread.

## Results — 2026-10-05, Apple M4 Pro, Chromium 1234 (Playwright 1.62.1)

| | Stress: 12 tanks, 36 shells, every effect | Live: 10 minutes against 11 bots |
| --- | --- | --- |
| Frames | 2,401 in 20 s — 120 Hz, the display's rate | 72,095 in 10 min — 120 Hz |
| Interval p50 / p99 | 8.3 / 9.3 ms | 8.3 / 9.3 ms |
| Frames over 25 ms | **0** | **0** |
| Loop work p50 / p99 / max | 1.1 / **2.0** / 2.4 ms | 0.8 / **1.7** / 3.8 ms |
| Heap after a forced GC, each minute | — | **7.38 → 7.64 MB**, between 7.38 and 8.31 |
| Hidden tab | **0** frames in 3 s hidden, 121 in the second after | |

Boot to the first frames: 517 ms. In the live run the view held up to 8 tanks and 14 shells at
once — the view is a square around the own tank, so a room of 12 is rarely all on screen, which is
why the stress run exists.

**The same page with no GPU** (`RICOCHET_PERF_GPU=0`: SwiftShader, rasterising on the throttled CPU —
slower than any phone's GPU, a bound and not a profile): stress 62 fps, interval p95 17.6 ms, 8 of
1,244 frames over 25 ms; live 67 fps, 12 of 4,002. The loop's own work stayed at 2.5 ms at p99:
what is left there is fill. Drawing the floor's grid as lines rather than a screen-sized tiled sprite
took this run from 56 fps and 57 long frames to the figures above.

## What was decided from them

- **The floor is the camera's clear colour and its grid a handful of lines**, not a `TileSprite`:
  the tiled sprite shaded every pixel a second time, the cost a weak GPU feels first.
- **The canvas draws at most 2 device pixels to the CSS pixel.** A phone's third costs half again
  the fill for detail no one sees at arm's length.
- **The loop sleeps while the tab is hidden.** Phaser 4 marks a hidden game paused and leaves the
  stopping to the browser's frame timer; asleep, it requests no frames at all — measured above with
  the page made hidden, which a headless browser does not do by itself.
- **Snapshots stay at 30 Hz** (the open question since S1). The page draws between snapshots at the
  display's rate either way, so the motion looks the same; what 15 Hz changes is the interpolation
  delay — two snapshot intervals, 133 ms instead of 66, the others drawn that much further in the
  past for a shooter to aim at — to save 0.8 KB/s the 6 KB/s budget does not need.

# The feel — ROADMAP C2

`pnpm build && pnpm --filter @ricochet/web feel` ([`apps/web/scripts/feel.mjs`](../../apps/web/scripts/feel.mjs))
puts a TCP proxy between the page and the server that holds every byte **75 ms each way** — 150 ms
of round trip, delivered in order as TCP does — and drives the page in Chromium. A trial starts
from a standing, loaded tank, just after a frame; it counts the frames until the first one that
shows the effect.

## Results — 2026-10-06, Apple M4 Pro, Chromium 1234

| | |
| --- | --- |
| A key to the own tank drawn moved | **1 frame** in 20 of 20 |
| A press to the own shell drawn | **1 frame** in 20 of 20 |
| Touch: two sticks pushed | the sticks shown, the tank driven 268 units in 1.2 s, 3 shots |
| A gamepad: left stick, right trigger | the sticks hidden, the tank driven 264 units, 3 shots |
| 10 minutes against eleven bots: hits drawn | **649, each a `hit` the server sent**; 651 sent |
| … own shells that stopped being drawn | 922, **every one at its hit, its wall, its age or a refusal** — none at a tank it passed |
| … own shots | 945 predicted, 874 adopted, 26 fizzled (the tank killed or out of shells by then), 3 the server fired unforeseen |
| … the step at adoption | **1.5 units** on average, 26 at worst |

## What was decided from them

- **The own tank is drawn toward the next input,** not between the last two: from the newest
  predicted tick toward the tank the intent *now* would make of it. A key shows on the next frame;
  when the tick comes and the input carries the same intent, the drawing is already there.
- **A press fires on its frame.** The page's `peek()` — the intent without consuming a press — lets
  `netcode` fire the shell the next input will carry, at once; a click shorter than a tick is
  latched until an input carries it.
- **Own shells fly in the server's present**, not the others' interpolated past, because that is
  where the server's shell will be (ADR-0002) — and its fast-forward counts the input's wait in the
  queue (protocol D16). What the 100 ms cap leaves over, the client eases its shell back by before
  the adoption: at 150 ms the step fell from 34 units to 1.5.
