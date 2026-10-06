import { describe, expect, it } from 'vitest';
import { hex } from './__fixtures__/golden.js';
import { decodeClient, decodeServer, validName } from './index.js';

/** Malformed frames, each one field away from a golden one — refused as values, with a reason. */
describe('the client decoder refuses', () => {
  it.each([
    ['an unknown type', '06 00', /unknown client message/],
    ['reserved hello flags', '01 01 02 03 416e6e', /reserved hello flags/],
    ['an overlong UTF-8 name', '01 01 00 02 c080', /not UTF-8/],
    ['a surrogate in a name', '01 01 00 03 eda080', /not UTF-8/],
    ['a control character in a name', '01 01 00 03 41 07 41', /rules refuse/],
    ['a bidi override in a name', '01 01 00 05 41 e280ae 41', /rules refuse/],
    ['an empty name', '01 01 00 00', /rules refuse/],
    ['a name with a leading space', '01 01 00 02 2041', /rules refuse/],
    ['a name over 48 bytes', `01 01 00 31 ${'41'.repeat(49)}`, /over 48 bytes/],
    ['reserved input bits', '02 01000000 00004000', /reserved input bits/],
    ['a move direction without moving', '02 01000000 00040000', /without moving/],
    ['input seq 0', '02 00000000 00000000', /seq 0/],
    ['lab latency past a second', '04 e903 0000', /latency over 1000/],
    ['lab jitter past half a second', '04 0000 f501', /jitter over 500/],
    ['a stall of nothing', '05 0000', /stall not in/],
    ['a stall past five seconds', '05 8913', /stall not in/],
  ])('%s', (_name, bytes, reason) => {
    const r = decodeClient(hex(bytes));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(reason);
  });
});

describe('the server decoder refuses', () => {
  const head = '82 64000000 05000000';
  it.each([
    ['an unknown type', '86', /unknown server message/],
    ['an unknown error code', '85 09', /unknown error code/],
    ['a pong offset longer than a tick', '84 0100 1e000000 3682', /longer than a tick/],
    ['reserved welcome flags', `81 01 0700 ${'00'.repeat(16)} 00000000 02 00`, /reserved welcome/],
    ['four shells in the air', `${head} 00 04 00 00 00 00 00 00 00`, /more shells/],
    ['a crate spot that does not exist', `${head} 00 00 00 00 10 00 00 00 00 00`, /crate/],
    [
      'a tank update that changes nothing',
      `${head} 00 00 00 00 00 00 01 0100 00 00 00 00`,
      /changes nothing/,
    ],
    [
      'a position both absolute and relative',
      `${head} 00 00 00 00 00 00 01 0100 03 0000 0000 00 00 00 00`,
      /both absolute/,
    ],
    [
      'a coordinate outside the arena',
      `${head} 00 00 00 00 00 00 01 0100 01 0040 0000 00 00 00`,
      /outside the arena/,
    ],
    [
      'reserved tank mask bits',
      `${head} 00 00 00 00 00 00 01 0100 08 00 00 00`,
      /reserved tank mask/,
    ],
    [
      'reserved shell bits',
      `${head} 00 00 00 00 00 00 00 00 01 0100 0100 0000 0000 0008 00 00`,
      /reserved shell/,
    ],
    [
      'a shell older than its life',
      `${head} 00 00 00 00 00 00 00 00 01 0100 0100 0000 0000 0000 31 00`,
      /older than its life/,
    ],
    ['an unknown event', `${head} 00 00 00 00 00 00 00 00 00 01 09`, /unknown event/],
    [
      'a hit leaving four hit points',
      `${head} 00 00 00 00 00 00 00 00 00 01 02 0100 0200 04`,
      /hit points/,
    ],
  ])('%s', (_name, bytes, reason) => {
    const r = decodeServer(hex(bytes));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(reason);
  });
});

describe('validName', () => {
  it.each(['Ann', 'Мира', '李小龙', 'x', 'sixteen chars ok', 'a b', '🙂🙂'])(
    'accepts %j',
    (name) => {
      expect(validName(name)).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['seventeen code points', 'seventeen chars!!'],
    ['a leading space', ' Ann'],
    ['a trailing space', 'Ann '],
    ['a tab', 'A\tB'],
    ['DEL', 'A\u007fB'],
    ['a C1 control', 'A\u0085B'],
    ['a line separator', 'A B'],
    ['a right-to-left override', 'A‮B'],
    ['a bidi isolate', 'A⁧B'],
    ['sixteen emoji, 64 bytes', '🙂'.repeat(16)],
  ])('refuses %s', (_name, name) => {
    expect(validName(name)).toBe(false);
  });
});
