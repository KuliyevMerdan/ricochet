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
});
