# ADR-0003 — One WebSocket, and what its head-of-line blocking costs

- **Status:** accepted
- **Date:** 2026-10-03
- **Applies to:** `protocol`, `netcode`, `apps/server`.

## Context

A real-time game wants **unreliable, unordered** delivery: a snapshot from 100 ms ago is worthless
once a newer one exists, and a lost one should simply be skipped. Native games use UDP for this.

A browser offers three transports:

| | Delivery | Server side | Hosting |
| --- | --- | --- | --- |
| **WebSocket** | TCP: reliable, ordered | any HTTP server (`ws`) | anywhere, through any proxy |
| **WebRTC data channel** | can be unreliable and unordered (SCTP over DTLS over UDP) | a WebRTC stack, ICE, STUN — TURN for strict NATs | UDP ports open; a signalling path |
| **WebTransport** | datagrams, unreliable; or streams | HTTP/3 (QUIC) server | UDP open, TLS certificate; Safari support arrived late and is still uneven |

The cost of TCP for a game is **head-of-line blocking**: when one segment is lost, everything after
it waits for the retransmit, typically one round trip or more. Nothing is lost — it arrives late, in
a burst.

## Decision

**One WebSocket per player, binary frames, carrying the protocol in
[`docs/protocol.md`](../protocol.md). The protocol is designed for what TCP actually does — stall,
then burst — rather than pretending to be UDP.**

- **No snapshot acknowledgements** (§ 5.2): every frame sent on a socket arrives, in order, or the
  socket dies; the last frame sent is the delta baseline.
- **No input redundancy:** a UDP game repeats each input in the next few packets to survive loss;
  here a lost segment delays inputs, it does not lose them. The server's input queue absorbs the
  burst, bounded at `inputQueueMax` (the oldest dropped, the client corrected).
- **The client is built for stalls:** the interpolation buffer adapts to the lateness it sees, a
  late snapshot extrapolates one tick and then holds, and prediction keeps the own tank responsive
  through the stall — the inputs reach the server late, and the correction afterwards is the visible
  cost (C0).
- **The server does not let a slow socket build a queue:** past a bound of `bufferedAmount`, it
  skips a client's snapshots rather than queueing them, and the next delta is against what it last
  sent (P0).
- **The network lab simulates the right failure** (C3): latency, jitter and **stalls** — not packet
  loss, which a WebSocket cannot show you.

## Consequences

- **It runs everywhere.** One origin, one port, the free hosting tier the other projects use
  (Render), every browser including Safari on an iPhone, through corporate proxies. A portfolio demo
  that a recruiter cannot open is not a demo.
- **Bad Wi-Fi feels worse than it would over UDP.** A 2 % loss link shows as periodic ~150–300 ms
  stalls instead of as a few missing snapshots. The design above makes them survivable, not
  invisible.
- **The protocol stays transport-agnostic in shape.** Messages are self-contained binary frames; a
  move to WebTransport datagrams would add snapshot acknowledgements and input redundancy back (the
  two things removed above) and change nothing else. That is the exit, written down.

## Alternatives considered

- **WebRTC data channels** — the right delivery semantics, at the cost of an ICE/STUN/TURN stack on
  the server, a signalling path, UDP on a host whose free tier offers none, and connection setup
  that fails silently behind some NATs. Too much machinery for what a demo can host.
- **WebTransport** — the future and the right shape (QUIC datagrams), but it needs an HTTP/3 server
  with UDP open, and its browser support was not yet something a stranger's phone could be assumed
  to have.
