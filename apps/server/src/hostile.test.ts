import { RULES, apply, decodeServer, encodeClient } from '@ricochet/protocol';
import type { Input, ServerMessage, View } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { Connection } from './connection.js';
import type { Socket } from './connection.js';
import { Lobby } from './lobby.js';
import { CLOSE_BYTES, Room, SKIP_BYTES } from './room.js';
import type { Peer } from './room.js';

/**
 * ROADMAP P0: what a hostile or merely slow client can do to the server — and cannot. An input is a
 * direction and buttons, so speed is not a claim a client can make; a flood is bounded by the queue
 * and the rate; a token leads only to its own tank, in its own room, within its grace; a socket
 * that stops reading is skipped, then closed, and never breaks the deltas.
 */

function peer(backlog = { bytes: 0 }) {
  const got: ServerMessage[] = [];
  let closed: string | null = null;
  const p: Peer = {
    send: (frame) => {
      const d = decodeServer(frame);
      if (!d.ok) throw new Error(d.reason);
      got.push(d.value);
    },
    close: (reason = 'replaced') => (closed = reason),
    rttMs: () => null,
    backlog: () => backlog.bytes,
  };
  return { p, got, closed: () => closed };
}

const input = (seq: number, over: Partial<Input> = {}): Input => ({
  type: 'input',
  seq,
  aim: 0,
  move: 0,
  fire: false,
  ...over,
});

const hello = (name: string) => ({ type: 'hello' as const, version: 1, token: null, name });

function lobby(maxRooms = 2) {
  let n = 0;
  return new Lobby({
    maxRooms,
    idleTicks: 60,
    token: () => `tok${n++}`,
    seed: () => 1,
    tick: () => 0,
  });
}

describe('a hostile client', () => {
  it('cannot drive faster by sending more: a hundred inputs a tick move the tank one step a tick', () => {
    const room = new Room(1, 1, 0);
    const a = peer();
    const p = room.add('Ann', 't', a.p);
    const at = () => {
      const t = room.world.tanks.find((x) => x.id === p.id);
      return { x: t?.x ?? 0, y: t?.y ?? 0 };
    };
    let seq = 0;
    let moved = 0;
    for (let tick = 0; tick < 20; tick++) {
      for (let i = 0; i < 100; i++) room.input(p, input(++seq));
      const before = at();
      room.tick();
      const after = at();
      moved = Math.max(moved, Math.hypot(after.x - before.x, after.y - before.y));
      // The queue holds the newest few, never the flood.
      expect(p.queue.length).toBeLessThanOrEqual(RULES.inputQueueMax);
    }
    expect(moved).toBeLessThanOrEqual(RULES.tankSpeed + 1);
  });

  it('is refused past twice the tick rate of inputs, and its pings past twenty a second go unanswered', () => {
    const got: ServerMessage[] = [];
    let refused: string | null = null;
    const socket: Socket = {
      send: (f) => {
        const d = decodeServer(f);
        if (d.ok) got.push(d.value);
      },
      close: () => {},
      refuse: (code) => (refused = code),
      rttMs: () => null,
      backlog: () => 0,
      link: null,
    };
    const hexLobby = new Lobby({
      maxRooms: 1,
      idleTicks: 60,
      token: () => '00'.repeat(16),
      seed: () => 1,
      tick: () => 0,
    });
    const c = new Connection(socket, hexLobby, {
      now: () => 0,
      phase: () => ({ tick: 0, offsetMs: 0 }),
    });
    c.receive(encodeClient({ type: 'hello', version: 1, token: null, name: 'Eve' }));
    for (let id = 1; id <= 200; id++) c.receive(encodeClient({ type: 'ping', id }));
    expect(got.filter((m) => m.type === 'pong')).toHaveLength(20);
    for (let seq = 1; seq <= 2 * RULES.tickHz; seq++) c.receive(encodeClient(input(seq)));
    expect(refused).toBeNull();
    c.receive(encodeClient(input(2 * RULES.tickHz + 1)));
    expect(refused).toBe('RATE');
  });

  it('gets nobody else’s tank from a token: forged, outlived, or from a room since closed', () => {
    const l = lobby(3);
    const ann = l.enter(hello('Ann'), null, peer().p);
    if (!ann.ok) throw new Error('no room');
    // A forged token is no token: a new tank.
    const forged = l.enter(hello('Eve'), 'f'.repeat(32), peer().p);
    expect(forged.ok && !forged.resumed && forged.player.id !== ann.player.id).toBe(true);

    // Ann's room empties and closes; her token closes with it, and leads into no other room.
    l.leave(ann.room, ann.player, ann.player.peer ?? peer().p);
    if (forged.ok) l.leave(forged.room, forged.player, forged.player.peer ?? peer().p);
    for (let i = 0; i < 61; i++) l.tick();
    expect(l.rooms).toHaveLength(0);
    const bob = l.enter(hello('Bob'), null, peer().p);
    const back = l.enter(hello('Ann'), ann.player.token, peer().p);
    expect(back.ok && back.resumed).toBe(false);
    expect(back.ok && bob.ok && back.player.id).not.toBe(bob.ok && bob.player.id);
  });
});

describe('a slow client', () => {
  it('has its snapshots skipped, not queued — the next a delta of the last sent, carrying the events between', () => {
    const room = new Room(1, 1, 0);
    const backlog = { bytes: 0 };
    const slow = peer(backlog);
    const p = room.add('Ann', 't', slow.p);
    const other = room.add('Bob', 'u', peer().p);
    const held: { view: View | null } = { view: null };
    const take = () => {
      for (const m of slow.got.splice(0)) {
        if (m.type !== 'snapshot') continue;
        const r = apply(held.view, m);
        if (!r.ok) throw new Error(r.reason);
        held.view = r.value;
      }
    };
    room.tick();
    take();
    const before = held.view;

    // Ann's socket falls behind just as she shoots Bob, one hit point left, standing in front of her.
    room.world = {
      ...room.world,
      tanks: room.world.tanks.map((t) =>
        t.id === p.id
          ? { ...t, x: 8000, y: 3500, turret: 0, shield: 0, reload: 0 }
          : { ...t, x: 8700, y: 3500, hp: 1, shield: 0 },
      ),
    };
    backlog.bytes = SKIP_BYTES + 1;
    room.input(p, input(1, { move: null, fire: true }));
    for (let i = 0; i < 10; i++) room.tick();
    const kill = { type: 'kill', killer: p.id, victim: other.id };
    expect(slow.got.filter((m) => m.type === 'snapshot')).toHaveLength(0);
    expect(p.carried).toContainEqual(kill);

    backlog.bytes = 0;
    room.tick();
    take();
    // One snapshot, a delta against the last one sent eleven ticks ago, applied cleanly — the kill,
    // the shot and the hit it missed riding it.
    expect(held.view).not.toBe(before);
    expect(held.view?.tick).toBe(room.world.tick);
    expect(held.view?.tanks.find((t) => t.id === other.id)?.alive).toBe(false);
    expect(held.view?.events).toContainEqual(kill);
    expect(held.view?.events.some((e) => e.type === 'shot' && e.seq === 1)).toBe(true);
    expect(p.carried).toEqual([]);
    expect(slow.closed()).toBeNull();
  });

  it('is closed past the second bound, its tank left to wait out the grace', () => {
    const room = new Room(1, 1, 0);
    const backlog = { bytes: CLOSE_BYTES + 1 };
    const slow = peer(backlog);
    const p = room.add('Ann', 't', slow.p);
    room.tick();
    expect(slow.closed()).toBe('too slow');
    expect(p.peer).toBeNull();
    expect(p.goneAt).toBe(room.world.tick);
    expect(room.players.has(p.id)).toBe(true);
  });
});
