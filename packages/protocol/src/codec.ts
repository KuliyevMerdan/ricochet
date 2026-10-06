import { ARENA_EIGHTHS } from '@ricochet/geom';
import { Reader, Writer } from './bytes.js';
import {
  CLIENT_MESSAGES,
  ERROR_CODES,
  EVENT_TYPES,
  LAB_LIMITS,
  NAME_MAX_BYTES,
  SERVER_MESSAGES,
  TOKEN_BYTES,
  validName,
} from './messages.js';
import type {
  ClientMessage,
  ErrorCode,
  GameEvent,
  RosterEntry,
  ServerMessage,
  Shell,
  Snapshot,
  TankPos,
  TankState,
  TankUpdate,
} from './messages.js';
import { fail, ok } from './result.js';
import type { Result } from './result.js';
import { RULES } from './rules.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

// ── bit layouts (docs/protocol.md § 4) ───────────────────────────────────────────────────────────

const DIR_BITS = 0x3ff;

/** `input`'s 32 bits: aim 0–9, move 10–19, moving 20, fire 21, the rest zero. */
const INPUT_MOVING = 1 << 20;
const INPUT_FIRE = 1 << 21;
const INPUT_RESERVED = ~((1 << 22) - 1) >>> 0;

/** A tank's state in 24 bits: hull 0–9, turret 10–19, hp 20–21, shield 22, alive 23. */
function packState(s: TankState): number {
  return (
    s.hull | (s.turret << 10) | (s.hp << 20) | (Number(s.shield) << 22) | (Number(s.alive) << 23)
  );
}

function unpackState(bits: number): TankState {
  return {
    hull: bits & DIR_BITS,
    turret: (bits >>> 10) & DIR_BITS,
    hp: (bits >>> 20) & 0b11,
    shield: ((bits >>> 22) & 1) === 1,
    alive: ((bits >>> 23) & 1) === 1,
  };
}

/** A tank update's mask. */
const POS_ABS = 0x01;
const POS_REL = 0x02;
const STATE = 0x04;

/** A shell's direction and bounce in 16 bits: dir 0–9, bounced 10, the rest zero. */
const SHELL_BOUNCED = 1 << 10;

const HELLO_HAS_TOKEN = 0x01;
const WELCOME_RESUMED = 0x01;
const ROSTER_BOT = 0x01;

function isErrorCode(key: string): key is ErrorCode {
  return key in ERROR_CODES;
}

const ERROR_BY_BYTE = new Map<number, ErrorCode>();
for (const [code, byte] of Object.entries(ERROR_CODES)) {
  if (isErrorCode(code)) ERROR_BY_BYTE.set(byte, code);
}

// ── encoding ─────────────────────────────────────────────────────────────────────────────────────

function name(w: Writer, text: string): void {
  const bytes = encodeUtf8(text);
  w.u8(bytes.length).bytes(bytes);
}

/** A client's frame. Throws on a value its field cannot hold: our own data, so a bug. */
export function encodeClient(msg: ClientMessage): Uint8Array {
  const w = new Writer();
  switch (msg.type) {
    case 'hello':
      w.u8(CLIENT_MESSAGES.hello)
        .u8(msg.version)
        .u8(msg.token ? HELLO_HAS_TOKEN : 0);
      if (msg.token) w.bytes(token(msg.token));
      name(w, msg.name);
      break;
    case 'input': {
      const move = msg.move === null ? 0 : (dir(msg.move) << 10) | INPUT_MOVING;
      w.u8(CLIENT_MESSAGES.input)
        .u32(msg.seq)
        .u32((dir(msg.aim) | move | (msg.fire ? INPUT_FIRE : 0)) >>> 0);
      break;
    }
    case 'ping':
      w.u8(CLIENT_MESSAGES.ping).u16(msg.id);
      break;
    case 'lab':
      w.u8(CLIENT_MESSAGES.lab).u16(msg.latencyMs).u16(msg.jitterMs);
      break;
    case 'stall':
      w.u8(CLIENT_MESSAGES.stall).u16(msg.ms);
      break;
  }
  return w.done();
}

/** A server's frame. Throws on a value its field cannot hold: our own data, so a bug. */
export function encodeServer(msg: ServerMessage): Uint8Array {
  const w = new Writer();
  switch (msg.type) {
    case 'welcome':
      w.u8(SERVER_MESSAGES.welcome)
        .u8(msg.version)
        .u16(msg.you)
        .bytes(token(msg.token))
        .u32(msg.tick)
        .u8(msg.resumed ? WELCOME_RESUMED : 0)
        .u8(msg.arena);
      break;
    case 'snapshot':
      snapshot(w, msg);
      break;
    case 'roster':
      w.u8(SERVER_MESSAGES.roster).u8(msg.entries.length);
      for (const e of msg.entries) {
        w.u16(e.id)
          .u8(e.bot ? ROSTER_BOT : 0)
          .u16(e.score);
        name(w, e.name);
      }
      break;
    case 'pong':
      w.u8(SERVER_MESSAGES.pong).u16(msg.id).u32(msg.tick).u16(msg.offsetUs);
      break;
    case 'error':
      w.u8(SERVER_MESSAGES.error).u8(ERROR_CODES[msg.code]);
      break;
  }
  return w.done();
}

function token(t: Uint8Array): Uint8Array {
  if (t.length !== TOKEN_BYTES)
    throw new RangeError(`a token is ${TOKEN_BYTES} bytes, not ${t.length}`);
  return t;
}

function dir(d: number): number {
  if (!Number.isInteger(d) || d < 0 || d > DIR_BITS) throw new RangeError(`direction ${d}`);
  return d;
}

function coord(w: Writer, v: number): void {
  if (v >= ARENA_EIGHTHS) throw new RangeError(`coordinate ${v} is outside the arena`);
  w.u16(v);
}

function snapshot(w: Writer, s: Snapshot): void {
  w.u8(SERVER_MESSAGES.snapshot).u32(s.tick).u32(s.ack);
  w.u8(s.self.reload).u8(s.self.shells).u8(s.self.respawn).u8(s.self.shield);
  w.u8(s.crates);

  w.u8(s.tanks.removed.length);
  for (const id of s.tanks.removed) w.u16(id);
  w.u8(s.tanks.updated.length);
  for (const u of s.tanks.updated) {
    const mask =
      (u.pos?.kind === 'abs' ? POS_ABS : 0) |
      (u.pos?.kind === 'rel' ? POS_REL : 0) |
      (u.state ? STATE : 0);
    if (mask === 0) throw new RangeError(`tank ${u.id}: an update that changes nothing`);
    w.u16(u.id).u8(mask);
    if (u.pos?.kind === 'abs') {
      coord(w, u.pos.x);
      coord(w, u.pos.y);
    } else if (u.pos?.kind === 'rel') {
      w.i8(u.pos.dx).i8(u.pos.dy);
    }
    if (u.state) w.u24(packState(u.state));
  }

  w.u8(s.shells.removed.length);
  for (const id of s.shells.removed) w.u16(id);
  w.u8(s.shells.added.length);
  for (const sh of s.shells.added) {
    w.u16(sh.id).u16(sh.owner);
    coord(w, sh.x);
    coord(w, sh.y);
    w.u16(dir(sh.dir) | (sh.bounced ? SHELL_BOUNCED : 0)).u8(sh.age);
  }

  w.u8(s.events.length);
  for (const e of s.events) {
    w.u8(EVENT_TYPES[e.type]);
    switch (e.type) {
      case 'shot':
        w.u16(e.shell).u16(e.tank).u32(e.seq);
        break;
      case 'hit':
        w.u16(e.shell).u16(e.victim).u8(e.hp);
        break;
      case 'kill':
        w.u16(e.killer).u16(e.victim);
        break;
      case 'crate':
        w.u8(e.spot).u16(e.tank);
        break;
      case 'spawn':
        w.u16(e.tank);
        break;
    }
  }
}

// ── decoding ─────────────────────────────────────────────────────────────────────────────────────

/** Thrown inside a decoder and caught at its door, so a field check is one line. Never escapes. */
class Malformed {
  constructor(readonly reason: string) {}
}

function need(cond: boolean, reason: string): void {
  if (!cond) throw new Malformed(reason);
}

function readName(r: Reader): string {
  const len = r.u8();
  need(len <= NAME_MAX_BYTES, 'a name over 48 bytes');
  const text = decodeUtf8(r.bytes(len));
  need(text !== null, 'a name that is not UTF-8');
  need(r.failed || validName(text ?? ''), 'a name the rules refuse');
  return text ?? '';
}

function readCoord(r: Reader): number {
  const v = r.u16();
  need(v < ARENA_EIGHTHS, 'a coordinate outside the arena');
  return v;
}

function finish<T>(r: Reader, value: T): Result<T> {
  if (r.failed) return fail('truncated');
  if (!r.complete) return fail('trailing bytes');
  return ok(value);
}

function guarded<T>(bytes: Uint8Array, body: (r: Reader) => T): Result<T> {
  const r = new Reader(bytes);
  try {
    return finish(r, body(r));
  } catch (e) {
    // A field check failing on a zero read past the end is truncation, not a bad value.
    if (e instanceof Malformed) return fail(r.failed ? 'truncated' : e.reason);
    throw e;
  }
}

/** A frame the server received. Anything but a well-formed client message is refused, as a value. */
export function decodeClient(bytes: Uint8Array): Result<ClientMessage> {
  return guarded<ClientMessage>(bytes, (r) => {
    const type = r.u8();
    switch (type) {
      case CLIENT_MESSAGES.hello: {
        const version = r.u8();
        const flags = r.u8();
        need((flags & ~HELLO_HAS_TOKEN) === 0, 'reserved hello flags');
        const tok = flags & HELLO_HAS_TOKEN ? r.bytes(TOKEN_BYTES) : null;
        return { type: 'hello', version, token: tok, name: readName(r) };
      }
      case CLIENT_MESSAGES.input: {
        const seq = r.u32();
        const bits = r.u32();
        need((bits & INPUT_RESERVED) === 0, 'reserved input bits');
        const moving = (bits & INPUT_MOVING) !== 0;
        const move = (bits >>> 10) & DIR_BITS;
        need(moving || move === 0, 'a move direction without moving');
        need(seq > 0, 'input seq 0');
        return {
          type: 'input',
          seq,
          aim: bits & DIR_BITS,
          move: moving ? move : null,
          fire: (bits & INPUT_FIRE) !== 0,
        };
      }
      case CLIENT_MESSAGES.ping:
        return { type: 'ping', id: r.u16() };
      case CLIENT_MESSAGES.lab: {
        const latencyMs = r.u16();
        const jitterMs = r.u16();
        need(latencyMs <= LAB_LIMITS.latencyMs, 'lab latency over 1000 ms');
        need(jitterMs <= LAB_LIMITS.jitterMs, 'lab jitter over 500 ms');
        return { type: 'lab', latencyMs, jitterMs };
      }
      case CLIENT_MESSAGES.stall: {
        const ms = r.u16();
        need(ms > 0 && ms <= LAB_LIMITS.stallMs, 'a stall not in 1…5000 ms');
        return { type: 'stall', ms };
      }
      default:
        throw new Malformed(`unknown client message 0x${type.toString(16)}`);
    }
  });
}

/** A frame the client received. Anything but a well-formed server message is refused, as a value. */
export function decodeServer(bytes: Uint8Array): Result<ServerMessage> {
  return guarded<ServerMessage>(bytes, (r) => {
    const type = r.u8();
    switch (type) {
      case SERVER_MESSAGES.welcome: {
        const version = r.u8();
        const you = r.u16();
        const tok = r.bytes(TOKEN_BYTES);
        const tick = r.u32();
        const flags = r.u8();
        need((flags & ~WELCOME_RESUMED) === 0, 'reserved welcome flags');
        const arena = r.u8();
        return {
          type: 'welcome',
          version,
          you,
          token: tok,
          tick,
          resumed: (flags & WELCOME_RESUMED) !== 0,
          arena,
        };
      }
      case SERVER_MESSAGES.snapshot:
        return readSnapshot(r);
      case SERVER_MESSAGES.roster: {
        const n = r.u8();
        const entries: RosterEntry[] = [];
        for (let i = 0; i < n && !r.failed; i++) {
          const id = r.u16();
          const flags = r.u8();
          need((flags & ~ROSTER_BOT) === 0, 'reserved roster flags');
          entries.push({ id, bot: (flags & ROSTER_BOT) !== 0, score: r.u16(), name: readName(r) });
        }
        return { type: 'roster', entries };
      }
      case SERVER_MESSAGES.pong: {
        const id = r.u16();
        const tick = r.u32();
        const offsetUs = r.u16();
        need(offsetUs < 1_000_000 / RULES.tickHz, 'a pong offset longer than a tick');
        return { type: 'pong', id, tick, offsetUs };
      }
      case SERVER_MESSAGES.error: {
        const code = ERROR_BY_BYTE.get(r.u8());
        need(r.failed || code !== undefined, 'an unknown error code');
        return { type: 'error', code: code ?? 'MALFORMED' };
      }
      default:
        throw new Malformed(`unknown server message 0x${type.toString(16)}`);
    }
  });
}

function readSnapshot(r: Reader): Snapshot {
  const tick = r.u32();
  const ack = r.u32();
  const self = { reload: r.u8(), shells: r.u8(), respawn: r.u8(), shield: r.u8() };
  need(self.reload <= RULES.reload, 'a reload past the rules');
  need(self.shells <= RULES.maxShells, 'more shells than a tank may have');
  need(self.respawn <= RULES.respawn, 'a respawn past the rules');
  need(self.shield <= RULES.shield, 'a shield past the rules');
  const crates = r.u8();
  need(crates < 1 << RULES.crateSpots, 'a crate at a spot that does not exist');

  const tanksRemoved = ids(r);
  const updated: TankUpdate[] = [];
  for (let i = 0, n = r.u8(); i < n && !r.failed; i++) {
    const id = r.u16();
    const mask = r.u8();
    need(mask !== 0, 'a tank update that changes nothing');
    need((mask & ~(POS_ABS | POS_REL | STATE)) === 0, 'reserved tank mask bits');
    need(
      (mask & (POS_ABS | POS_REL)) !== (POS_ABS | POS_REL),
      'a tank position both absolute and relative',
    );
    let pos: TankPos | null = null;
    if (mask & POS_ABS) pos = { kind: 'abs', x: readCoord(r), y: readCoord(r) };
    if (mask & POS_REL) pos = { kind: 'rel', dx: r.i8(), dy: r.i8() };
    const state = mask & STATE ? unpackState(r.u24()) : null;
    updated.push({ id, pos, state });
  }

  const shellsRemoved = ids(r);
  const added: Shell[] = [];
  for (let i = 0, n = r.u8(); i < n && !r.failed; i++) {
    const id = r.u16();
    const owner = r.u16();
    const x = readCoord(r);
    const y = readCoord(r);
    const bits = r.u16();
    need((bits & ~(DIR_BITS | SHELL_BOUNCED)) === 0, 'reserved shell bits');
    const age = r.u8();
    need(age <= RULES.shellLife, 'a shell older than its life');
    added.push({
      id,
      owner,
      x,
      y,
      dir: bits & DIR_BITS,
      bounced: (bits & SHELL_BOUNCED) !== 0,
      age,
    });
  }

  const events: GameEvent[] = [];
  for (let i = 0, n = r.u8(); i < n && !r.failed; i++) events.push(readEvent(r));

  return {
    type: 'snapshot',
    tick,
    ack,
    self,
    crates,
    tanks: { removed: tanksRemoved, updated },
    shells: { removed: shellsRemoved, added },
    events,
  };
}

function ids(r: Reader): number[] {
  const out: number[] = [];
  for (let i = 0, n = r.u8(); i < n && !r.failed; i++) out.push(r.u16());
  return out;
}

function readEvent(r: Reader): GameEvent {
  const type = r.u8();
  switch (type) {
    case EVENT_TYPES.shot:
      return { type: 'shot', shell: r.u16(), tank: r.u16(), seq: r.u32() };
    case EVENT_TYPES.hit: {
      const e = { type: 'hit' as const, shell: r.u16(), victim: r.u16(), hp: r.u8() };
      need(e.hp <= RULES.hitPoints, 'hit points past the rules');
      return e;
    }
    case EVENT_TYPES.kill:
      return { type: 'kill', killer: r.u16(), victim: r.u16() };
    case EVENT_TYPES.crate: {
      const e = { type: 'crate' as const, spot: r.u8(), tank: r.u16() };
      need(e.spot < RULES.crateSpots, 'a crate spot that does not exist');
      return e;
    }
    case EVENT_TYPES.spawn:
      return { type: 'spawn', tank: r.u16() };
    default:
      throw new Malformed(`unknown event ${type}`);
  }
}
