# Ricochet

A **real-time multiplayer tank arena in the browser, .io style** — open the link, type a name,
drive. Top-down and twin-stick: the hull goes where you steer, the turret where you aim, and every
shell bounces off a wall once. Node + TypeScript on the server, Phaser in the browser, one WebSocket
carrying a binary protocol.

> ⚠️ **Status (2026-10-05): the server and the client's netcode run, nothing on screen yet.**
> **S0–S4** and **C0** have landed — the workspace and its enforced boundaries; the wire protocol,
> its three ADRs, exact integer geometry and a binary codec; the simulation; the server, which has
> held a room of 12 socket clients for five minutes, every tick within 2 ms of its deadline; bots and
> the bench; and the client's netcode, whose prediction matched the server's to the bit in every one
> of 17,750 ticks no other tank touched, over ten simulated minutes at 150 ± 40 ms. See
> [`ROADMAP.md`](ROADMAP.md) — the arena on screen (**C1**) is next.

## What makes it interesting to build

Not the tanks. The 150 milliseconds between your thumb and the server.

- **The server is the only authority**, and a client sends it inputs — never a position, a hit or a
  score.
- **Your own tank answers on the next frame anyway.** The client runs the server's own simulation
  on your inputs, and when the server's word arrives, rewinds to it and replays what it has not yet
  heard. The simulation computes the same bits in every browser and in Node — no `Math.sin` in it,
  enforced by lint — so a correction on screen means the server really disagreed.
- **Everyone else is drawn a little in the past**, between two snapshots that both exist, with a
  delay that adapts to your link's jitter.
- **Shells are fast-forwarded, not targets rewound**: yours starts on the server where your screen
  drew it, and hits are decided only there.
- **The wire is bytes**: the world in integer eighths of a unit, deltas against the last snapshot,
  a shell sent once and flown on by your own browser, and only what lies within your view.
- **And you can watch it work**: a ghost of the server's truth over your tank, the snapshot buffer,
  corrections per second, and a network lab that breaks only your own connection.

## Documents

| File | What it is |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | The canon — architecture, packages, rules. Kept current as code lands. |
| [`ROADMAP.md`](ROADMAP.md) | The task map — blocks, gates, `Done when`. |
| [`docs/protocol.md`](docs/protocol.md) | The wire contract — every message's bytes, the units, the rules. |
| [`docs/adr/`](docs/adr) | The decisions that everything else is downstream of. |
