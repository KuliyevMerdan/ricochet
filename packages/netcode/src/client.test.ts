import { PROTOCOL_VERSION, decodeClient, encodeServer } from '@ricochet/protocol';
import type { ClientMessage, ServerMessage, Snapshot } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { Scheduler } from './__fixtures__/net.js';
import { Client } from './client.js';
import type { ConnectionState, SocketEvents } from './client.js';

/** A client on hand-driven sockets: what it sends is decoded and kept; the test plays the server. */
function rig() {
  const sched = new Scheduler();
  const sockets: { events: SocketEvents; sent: ClientMessage[]; closed: boolean }[] = [];
  const states: ConnectionState['kind'][] = [];
  const client = new Client({
    name: 'Ann',
    clock: { now: () => sched.now },
    timers: { after: (ms, fn) => sched.at(sched.now + ms, fn) },
    intent: () => ({ aim: 0, move: 0, fire: false }),
    connect: (events) => {
      const s = { events, sent: [] as ClientMessage[], closed: false };
      sockets.push(s);
      return {
        send: (frame) => {
          const d = decodeClient(frame);
          if (!d.ok) throw new Error(d.reason);
          s.sent.push(d.value);
        },
        close: () => {
          s.closed = true;
        },
      };
    },
  });
  client.onState((s) => states.push(s.kind));
  const socket = () => {
    const s = sockets.at(-1);
    if (!s) throw new Error('no socket');
    return s;
  };
  const say = (m: ServerMessage) => socket().events.message(encodeServer(m));
  return { sched, client, sockets, states, socket, say };
}

const welcome = (resumed = false): ServerMessage => ({
  type: 'welcome',
  version: PROTOCOL_VERSION,
  you: 7,
  token: Uint8Array.from({ length: 16 }, (_, i) => i + 1),
  tick: 100,
  resumed,
  arena: 0,
});

const snapshot = (tick: number, over: Partial<Snapshot> = {}): Snapshot => ({
  type: 'snapshot',
  tick,
  ack: 0,
  self: { reload: 0, shells: 0, respawn: 0, shield: 0 },
  crates: 0,
  tanks: {
    removed: [],
    updated:
      tick === 101
        ? [
            {
              id: 7,
              pos: { kind: 'abs', x: 4000, y: 4000 },
              state: { hull: 0, turret: 0, hp: 3, shield: false, alive: true },
            },
          ]
        : [],
  },
  shells: { removed: [], added: [] },
  events: [],
  ...over,
});

describe('Client', () => {
  it('connects, says hello, is live on the welcome, pings, and once synced sends an input a tick', () => {
    const r = rig();
    expect(r.client.state.kind).toBe('connecting');
    r.socket().events.open();
    expect(r.client.state.kind).toBe('joining');
    expect(r.socket().sent[0]).toEqual({
      type: 'hello',
      version: PROTOCOL_VERSION,
      token: null,
      name: 'Ann',
    });

    r.say(welcome());
    expect(r.client.state).toEqual({ kind: 'live', you: 7, resumed: false });
    expect(r.socket().sent.filter((m) => m.type === 'ping')).toHaveLength(1);

    r.say(snapshot(101));
    r.say({ type: 'pong', id: 1, tick: 101, offsetUs: 0 });
    const seqs = () => r.socket().sent.flatMap((m) => (m.type === 'input' ? [m.seq] : []));
    // Nothing comes back: past a round trip's worth (0 here) and a full queue on the server, it
    // stops — more would only be dropped there.
    r.sched.run(500);
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6]);
    // Acknowledged, it carries on, one a tick, to the same bound past the acknowledgement.
    r.say(snapshot(102, { ack: 6 }));
    r.sched.run(1000);
    expect(seqs()).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(r.states).toEqual(['joining', 'live']);
  });

  it('takes its tank back after a dropped socket: the token in a new hello, inputs from seq 1', () => {
    const r = rig();
    r.socket().events.open();
    r.say(welcome());
    r.say(snapshot(101));
    r.say({ type: 'pong', id: 1, tick: 101, offsetUs: 0 });
    r.sched.run(300);
    r.socket().events.close();
    expect(r.client.state).toMatchObject({ kind: 'reconnecting', inMs: 250 });
    r.sched.run(600);
    expect(r.sockets).toHaveLength(2);
    r.socket().events.open();
    const hello = r.socket().sent[0];
    expect(hello?.type === 'hello' && [...(hello.token ?? [])]).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    r.say(welcome(true));
    r.say(snapshot(101)); // a fresh baseline: against nothing
    r.say({ type: 'pong', id: 1, tick: 120, offsetUs: 0 });
    r.sched.run(1200);
    const first = r.socket().sent.find((m) => m.type === 'input');
    expect(first?.type === 'input' && first.seq).toBe(1);
    expect(r.client.state).toEqual({ kind: 'live', you: 7, resumed: true });
  });

  it('reconnects at once for a snapshot that is not a delta of what it holds', () => {
    const r = rig();
    r.socket().events.open();
    r.say(welcome());
    r.say(snapshot(101));
    r.say(snapshot(102, { tanks: { removed: [99], updated: [] } }));
    expect(r.client.state).toMatchObject({ kind: 'reconnecting', inMs: 0 });
    expect(r.sockets[0]?.closed).toBe(true);
  });

  it('is outdated, not retrying, on a frame it cannot read or a version it does not speak', () => {
    const garbled = rig();
    garbled.socket().events.open();
    garbled.socket().events.message(Uint8Array.of(0x99));
    expect(garbled.client.state.kind).toBe('outdated');
    garbled.sched.run(10_000);
    expect(garbled.sockets).toHaveLength(1);

    const old = rig();
    old.socket().events.open();
    old.say({ type: 'error', code: 'VERSION' });
    expect(old.client.state.kind).toBe('outdated');
  });

  it('asks for another name on NAME, waits on FULL and RATE', () => {
    const name = rig();
    name.socket().events.open();
    name.say({ type: 'error', code: 'NAME' });
    expect(name.client.state).toEqual({ kind: 'refused', code: 'NAME' });
    name.sched.run(10_000);
    expect(name.sockets).toHaveLength(1);

    const full = rig();
    full.socket().events.open();
    full.say({ type: 'error', code: 'FULL' });
    expect(full.client.state).toMatchObject({ kind: 'reconnecting', inMs: 5000 });

    const rate = rig();
    rate.socket().events.open();
    rate.say({ type: 'error', code: 'RATE' });
    expect(rate.client.state).toMatchObject({ kind: 'reconnecting', inMs: 1000 });
  });

  it('closes for good, and ignores the socket after', () => {
    const r = rig();
    r.socket().events.open();
    r.say(welcome());
    r.client.close();
    expect(r.client.state.kind).toBe('closed');
    r.socket().events.close();
    r.sched.run(10_000);
    expect(r.client.state.kind).toBe('closed');
    expect(r.sockets).toHaveLength(1);
  });

  it('sends the lab on its own link, again after every welcome; stalls it; drops its own end', () => {
    const r = rig();
    const labs = () => r.socket().sent.filter((m) => m.type === 'lab');
    r.socket().events.open();
    r.client.lab({ latencyMs: 300, jitterMs: 40 });
    expect(labs()).toEqual([]); // not live yet: the welcome will carry it
    r.say(welcome());
    expect(labs()).toEqual([{ type: 'lab', latencyMs: 300, jitterMs: 40 }]);
    r.client.stall(2000);
    expect(r.socket().sent.at(-1)).toEqual({ type: 'stall', ms: 2000 });

    r.client.drop();
    expect(r.client.state).toMatchObject({ kind: 'reconnecting', inMs: 250 });
    expect(r.sockets[0]?.closed).toBe(true);
    r.sched.run(600);
    r.socket().events.open();
    r.say(welcome(true));
    // A new socket starts clean on the server: the lab goes again.
    expect(labs()).toEqual([{ type: 'lab', latencyMs: 300, jitterMs: 40 }]);

    r.client.lab({ latencyMs: 0, jitterMs: 0 });
    expect(labs().at(-1)).toEqual({ type: 'lab', latencyMs: 0, jitterMs: 0 });
    r.client.drop();
    r.sched.run(r.sched.now + 600);
    r.socket().events.open();
    r.say(welcome(true));
    expect(labs()).toEqual([]); // a clean link needs no word
  });

  it('draws the server ghost, and with the prediction or the interpolation off, the views as they come', () => {
    const r = rig(); // the intent drives east
    const state = { hull: 0, turret: 0, hp: 3, shield: false, alive: true };
    r.socket().events.open();
    r.say(welcome());
    r.say(
      snapshot(101, {
        tanks: {
          removed: [],
          updated: [
            { id: 7, pos: { kind: 'abs', x: 8000, y: 3500 }, state },
            { id: 9, pos: { kind: 'abs', x: 10_000, y: 9000 }, state },
          ],
        },
      }),
    );
    r.say({ type: 'pong', id: 1, tick: 101, offsetUs: 0 });
    for (let t = 102; t <= 106; t++) {
      r.sched.run(r.sched.now + 1000 / 30);
      r.say(
        snapshot(t, {
          tanks: {
            removed: [],
            updated: [{ id: 9, pos: { kind: 'rel', dx: 59, dy: 0 }, state: null }],
          },
        }),
      );
    }
    const newest = 10_000 + 59 * 5;

    const on = r.client.frame(r.sched.now);
    // The ghost: every tank where the newest snapshot has it — the own tank's has acknowledged nothing.
    expect(on.ghosts.map((t) => [t.id, t.x])).toEqual([
      [7, 8000],
      [9, newest],
    ]);
    expect(on.me?.x).toBeGreaterThan(8000 + 59); // predicted, ahead of the server
    const other = on.others.find((t) => t.id === 9);
    expect(other?.x).toBeLessThan(newest); // interpolated, behind the newest

    r.client.modes = { predict: false, interpolate: false };
    const off = r.client.frame(r.sched.now);
    expect(off.me?.x).toBe(8000); // the server's own tank, as the views have it
    expect(off.others.map((t) => [t.id, t.x])).toEqual([[9, newest]]);
    expect(off.offset).toEqual({ x: 0, y: 0 });

    // Switched back on, the prediction is where it was: it ran on underneath.
    r.client.modes = { predict: true, interpolate: true };
    expect(r.client.frame(r.sched.now).me?.x).toBeCloseTo(on.me?.x ?? 0, 0);
  });
});
