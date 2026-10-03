import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CLIENT_MESSAGES,
  ERROR_CODES,
  EVENT_TYPES,
  PROTOCOL_VERSION,
  RULES,
  SERVER_MESSAGES,
} from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lint-runner.js';

/**
 * "The protocol document and `packages/protocol` change together, in one commit, always"
 * (CLAUDE.md). This is the part of that rule a machine can check: the message table in § 4, the
 * event table in § 6, the error table in § 7 and the rules in § 8 name exactly what the code does.
 */
const doc = readFileSync(path.join(ROOT, 'docs/protocol.md'), 'utf8');

function section(heading: string, next: string): string {
  const start = doc.indexOf(heading);
  const end = doc.indexOf(next, start + heading.length);
  if (start < 0 || end < 0) throw new Error(`protocol.md has no section "${heading}"`);
  return doc.slice(start, end);
}

/** The first two ticked cells of every table row that starts with one: name and value. */
function table(text: string): Array<[string, string]> {
  return text
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line.split('|').map((c) => c.trim());
      const ticked = (cell: string | undefined) => /^`([^`]+)`/.exec(cell ?? '')?.[1] ?? '';
      return [ticked(cells[1]), ticked(cells[2])];
    });
}

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;

describe('docs/protocol.md and @ricochet/protocol agree', () => {
  it('on the version', () => {
    expect(doc).toContain(`Version **${PROTOCOL_VERSION}**`);
  });

  it('on every message and its type byte (§ 4)', () => {
    const code = [
      ...Object.entries(CLIENT_MESSAGES).map(([name, byte]) => [name, hex(byte)]),
      ...Object.entries(SERVER_MESSAGES).map(([name, byte]) => [name, hex(byte)]),
    ];
    expect(table(section('## 4. Messages', '### 4.1'))).toEqual(code);
  });

  it('on every event and its type byte (§ 6)', () => {
    const code = Object.entries(EVENT_TYPES).map(([name, byte]) => [name, String(byte)]);
    expect(table(section('## 6. Events', '## 7.'))).toEqual(code);
  });

  it('on every error code and its byte (§ 7)', () => {
    const code = Object.entries(ERROR_CODES).map(([name, byte]) => [name, String(byte)]);
    expect(table(section('## 7. Errors', '## 8.'))).toEqual(code);
  });

  it('on every rule and its value (§ 8)', () => {
    const code = Object.entries(RULES).map(([name, value]) => [name, String(value)]);
    expect(table(section('## 8. Rules', '## 9.'))).toEqual(code);
  });
});
