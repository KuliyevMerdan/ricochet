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
    expect(p.queue.map((q) => q.input.seq)).toEqual([5]);
    for (let s = 6; s <= 10; s++) room.input(p, input(s));
    expect(p.queue.map((q) => q.input.seq)).toEqual([7, 8, 9, 10]);
    expect(p.queue).toHaveLength(RULES.inputQueueMax);
  });

  it('stands a tank still through a late input, holding neither stick nor trigger (D15)', () => {
    const room = new Room(1, 1, 0);
    const p = room.add('Ann', 't', peer().p);
    for (let i = 0; i <= RULES.shield; i++) room.tick();
    const aim = room.world.tanks[0]?.hull ?? 0; // a fresh tank faces the open middle
    room.input(p, input(1, { fire: true, move: aim, aim }));
    room.tick();
    const fired = room.world.shells.length;
    const pose = () => {
      const t = room.world.tanks[0];
      return [t?.x, t?.y, t?.hull, t?.turret];
    };
    const after = pose();
    for (let i = 0; i < 5; i++) room.tick(); // no inputs arrive
    expect(pose()).toEqual(after); // not one eighth further, not one direction turned
    expect(fired).toBe(1);
    expect(room.world.shells.filter((s) => s.owner === p.id).length).toBeLessThanOrEqual(fired);
    room.input(p, input(2, { move: aim, aim }));
    room.tick();
    expect(pose()).not.toEqual(after); // and drives on when the next one comes
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

  it('fast-forwards it further by the ticks its input waited in the queue (protocol D16)', () => {
    const shot = (queuedBehind: number) => {
      const room = new Room(1, 1, 0);
      const p = room.add('Ann', 't', peer(40).p); // 40 ms: half is 0.6 of a tick
      for (let i = 0; i <= RULES.shield; i++) room.tick();
      const t = room.world.tanks[0];
      const aim = t?.hull ?? 0;
      // Inputs that arrived together: the shot waits a tick behind each one ahead of it.
      for (let seq = 1; seq <= queuedBehind; seq++) room.input(p, input(seq, { aim }));
      room.input(p, input(queuedBehind + 1, { fire: true, aim }));
      for (let i = 0; i <= queuedBehind; i++) room.tick();
      const s = room.world.shells[0];
      const along = step(aim, RULES.shellSpeed)[0];
      return Math.round(((s?.x ?? 0) - (t?.x ?? 0) - step(aim, RULES.muzzle)[0]) / along);
    };
    expect(shot(0)).toBe(1); // 0.6 + half a tick's wait
    expect(shot(1)).toBe(2); // 0.6 + a tick and a half
    expect(shot(3)).toBe(RULES.fastForwardMax); // capped
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

describe('Room with bots', () => {
  const bots = (room: Room) => [...room.players.values()].filter((p) => p.bot);

  it('fills itself to botsFillTo with bots, and they leave as people arrive', () => {
    const room = new Room(1, 1, 0, null, RULES.botsFillTo);
    const ann = room.add('Ann', 't1', peer().p);
    expect(bots(room)).toHaveLength(RULES.botsFillTo - 1);
    expect(room.world.tanks).toHaveLength(RULES.botsFillTo);
    expect(room.roster().filter((e) => e.bot)).toHaveLength(RULES.botsFillTo - 1);
    expect(room.roster().find((e) => e.id === ann.id)?.bot).toBe(false);

    room.add('Bob', 't2', peer().p);
    expect(bots(room)).toHaveLength(RULES.botsFillTo - 2);
    for (let i = 2; i < RULES.botsFillTo + 1; i++) room.add(`p${i}`, `t${i + 1}`, peer().p);
    expect(bots(room)).toHaveLength(0);
    expect(room.humans).toBe(RULES.botsFillTo + 1);
    expect(room.hasSeat).toBe(true);
  });

  it('takes a bot back once a person’s grace has run out, and tells everyone', () => {
    const room = new Room(1, 1, 0, null, RULES.botsFillTo);
    const a = peer();
    room.add('Ann', 't1', a.p);
    const bob = room.add('Bob', 't2', peer().p);
    room.detach(bob);
    for (let i = 0; i < RULES.resumeGrace; i++) room.tick();
    expect(bots(room)).toHaveLength(RULES.botsFillTo - 1);
    const roster = a.got.filter((m) => m.type === 'roster').at(-1);
    expect(roster?.type === 'roster' && roster.entries.filter((e) => e.bot)).toHaveLength(
      RULES.botsFillTo - 1,
    );
  });

  it('plays: its bots drive and fire on what they are shown', () => {
    const room = new Room(1, 7, 0, null, RULES.botsFillTo);
    room.add('Ann', 't1', peer().p);
    const start = new Map(room.world.tanks.map((t) => [t.id, t]));
    let fired = 0;
    for (let i = 0; i < 30 * 20; i++) {
      const before = new Set(room.world.shells.map((s) => s.id));
      room.tick();
      fired += room.world.shells.filter((s) => !before.has(s.id)).length;
    }
    for (const b of bots(room)) {
      const t = room.world.tanks.find((o) => o.id === b.id);
      const s = start.get(b.id);
      expect(t && s && (t.x !== s.x || t.y !== s.y), `${b.name} never moved`).toBe(true);
    }
    expect(fired).toBeGreaterThan(10);
  });

  it('seats people by people, not by tanks', () => {
    let n = 0;
    const l = new Lobby({
      maxRooms: 2,
      idleTicks: 60,
      token: () => `tok${n++}`,
      seed: () => 1,
      tick: () => 0,
      botsFillTo: RULES.botsFillTo,
    });
    for (let i = 0; i < RULES.roomSize; i++) {
      l.enter({ type: 'hello', version: 1, token: null, name: `p${i}` }, null, peer().p);
    }
    expect(l.rooms).toHaveLength(1);
    expect(l.players()).toBe(RULES.roomSize);
    expect(l.bots()).toBe(0);
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
