import { step } from '@ricochet/geom';
import { RULES, apply, decodeServer } from '@ricochet/protocol';
import type { Input, ServerMessage, View } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { Lobby } from './lobby.js';
import { Room } from './room.js';
import type { Peer } from './room.js';

/** A peer that keeps what it is sent, decoded. */
function peer(rtt: number | null = null) {
  const got: ServerMessage[] = [];
  let closed = false;
  const p: Peer = {
    send: (frame) => {
      const d = decodeServer(frame);
      if (!d.ok) throw new Error(d.reason);
      got.push(d.value);
    },
    close: () => (closed = true),
    rttMs: () => rtt,
  };
  return { p, got, isClosed: () => closed };
}

const input = (seq: number, over: Partial<Input> = {}): Input => ({
  type: 'input',
  seq,
  aim: 0,
  move: null,
  fire: false,
  ...over,
});

const snapshots = (got: ServerMessage[]) => got.filter((m) => m.type === 'snapshot');

describe('Room', () => {
  it('applies one input a tick in seq order, acknowledging each', () => {
    const room = new Room(1, 1, 0);
    const a = peer();
    const p = room.add('Ann', 't', a.p);
    for (const seq of [1, 2, 3]) room.input(p, input(seq, { aim: seq * 10 }));
    const acks: number[] = [];
    for (let i = 0; i < 4; i++) {
      room.tick();
      const s = snapshots(a.got).at(-1);
      acks.push(s?.type === 'snapshot' ? s.ack : -1);
    }
    expect(acks).toEqual([1, 2, 3, 3]);
    expect(room.world.tanks[0]?.turret).toBe(30);
  });

  it('ignores a repeated or older seq, and drops the oldest past inputQueueMax', () => {
    const room = new Room(1, 1, 0);
    const p = room.add('Ann', 't', peer().p);
    room.input(p, input(5));
    room.input(p, input(5));
    room.input(p, input(4));
    expect(p.queue.map((i) => i.seq)).toEqual([5]);
    for (let s = 6; s <= 10; s++) room.input(p, input(s));
    expect(p.queue.map((i) => i.seq)).toEqual([7, 8, 9, 10]);
    expect(p.queue).toHaveLength(RULES.inputQueueMax);
  });

  it('holds the stick through a late input, but not the trigger', () => {
    const room = new Room(1, 1, 0);
    const p = room.add('Ann', 't', peer().p);
    room.tick(); // let the spawn shield… not matter: we check shells only after it ends
    for (let i = 0; i < RULES.shield; i++) room.tick();
    room.input(p, input(1, { fire: true, move: 0 }));
    room.tick();
    const fired = room.world.shells.length;
    const x = room.world.tanks[0]?.x ?? 0;
    for (let i = 0; i < 20; i++) room.tick(); // no inputs arrive
    expect(room.world.shells.filter((s) => s.owner === p.id).length).toBeLessThanOrEqual(fired);
    expect(room.world.tanks[0]?.x).not.toBe(x); // still driving
  });

  it('fast-forwards a shell by the shooter’s measured half round trip (ADR-0002)', () => {
    const room = new Room(1, 1, 0);
    const p = room.add('Ann', 't', peer(100).p); // 100 ms: half is 50, a tick and a half → 2
    for (let i = 0; i <= RULES.shield; i++) room.tick();
    const t = room.world.tanks[0];
    const aim = t?.hull ?? 0; // a fresh tank faces the open middle of the arena
    room.input(p, input(1, { fire: true, aim }));
    room.tick();
    const s = room.world.shells[0];
    const along = (d: number, axis: 0 | 1) => step(aim, d)[axis];
    expect([s?.x, s?.y]).toEqual([
      (t?.x ?? 0) + along(RULES.muzzle, 0) + 2 * along(RULES.shellSpeed, 0),
      (t?.y ?? 0) + along(RULES.muzzle, 1) + 2 * along(RULES.shellSpeed, 1),
    ]);
  });

  it('sends a first snapshot against nothing, then deltas a client can apply', () => {
    const room = new Room(1, 1, 0);
    const a = peer();
    const ann = room.add('Ann', 't1', a.p);
    room.add('Bob', 't2', peer().p);
    let held: View | null = null;
    for (let i = 0; i < 30; i++) room.tick();
    for (const s of snapshots(a.got)) {
      if (s.type !== 'snapshot') continue;
      const r = apply(held, s);
      expect(r.ok).toBe(true);
      if (r.ok) held = r.value;
    }
    expect(held?.tanks).toEqual(ann.sent?.tanks);
    expect(held?.tick).toBe(30);
  });

  it('keeps a dropped player’s tank for resumeGrace ticks, then lets it go', () => {
    const room = new Room(1, 1, 0);
    const p = room.add('Ann', 't', peer().p);
    room.add('Bob', 't2', peer().p);
    room.detach(p);
    for (let i = 0; i < RULES.resumeGrace - 1; i++) room.tick();
    expect(room.players.has(p.id)).toBe(true);
    room.tick();
    expect(room.players.has(p.id)).toBe(false);
    expect(room.world.tanks.some((t) => t.id === p.id)).toBe(false);
  });

  it('sends everyone the whole roster', () => {
    const room = new Room(1, 1, 0);
    const a = peer();
    room.add('Ann', 't', a.p);
    room.add('Bob', 't2', peer().p);
    room.broadcastRoster();
    const rosters = a.got.filter((m) => m.type === 'roster');
    expect(rosters.at(-1)).toEqual({
      type: 'roster',
      entries: [
        { id: 1, bot: false, score: 0, name: 'Ann' },
        { id: 2, bot: false, score: 0, name: 'Bob' },
      ],
    });
  });
});

describe('Lobby', () => {
  const lobby = (maxRooms = 2) => {
    let n = 0;
    return new Lobby({
      maxRooms,
      idleTicks: 60,
      token: () => `tok${n++}`,
      seed: () => 1,
      tick: () => 0,
    });
  };
  const hello = (name: string) => ({ type: 'hello' as const, version: 1, token: null, name });

  it('fills the fullest room with a seat, opening one only when none has', () => {
    const l = lobby();
    for (let i = 0; i < RULES.roomSize; i++) l.enter(hello(`p${i}`), null, peer().p);
    expect(l.rooms).toHaveLength(1);
    const late = l.enter(hello('late'), null, peer().p);
    expect(l.rooms).toHaveLength(2);
    expect(late.ok && late.room).toBe(l.rooms[1]);
  });

  it('says FULL past maxRooms', () => {
    const l = lobby(1);
    for (let i = 0; i < RULES.roomSize; i++) l.enter(hello(`p${i}`), null, peer().p);
    expect(l.enter(hello('late'), null, peer().p)).toEqual({ ok: false, code: 'FULL' });
  });

  it('gives a token back its tank, and closes the socket it replaces', () => {
    const l = lobby();
    const first = peer();
    const e = l.enter(hello('Ann'), null, first.p);
    if (!e.ok) throw new Error('no room');
    const again = l.enter(hello('Ann'), e.player.token, peer().p);
    expect(again.ok && again.resumed && again.player.id).toBe(e.player.id);
    expect(first.isClosed()).toBe(true);
  });

  it('forgets a token once its grace has run out, and joins its owner afresh', () => {
    const l = lobby();
    const e = l.enter(hello('Ann'), null, peer().p);
    l.enter(hello('Bob'), null, peer().p);
    if (!e.ok) throw new Error('no room');
    l.leave(e.room, e.player, e.player.peer ?? peer().p);
    for (let i = 0; i < RULES.resumeGrace; i++) l.tick();
    const back = l.enter(hello('Ann'), e.player.token, peer().p);
    expect(back.ok && back.resumed).toBe(false);
  });

  it('closes a room nobody is connected to after its idle ticks', () => {
    const l = lobby();
    const e = l.enter(hello('Ann'), null, peer().p);
    if (!e.ok) throw new Error('no room');
    l.leave(e.room, e.player, e.player.peer ?? peer().p);
    for (let i = 0; i < 60; i++) l.tick();
    expect(l.rooms).toHaveLength(0);
  });
});
