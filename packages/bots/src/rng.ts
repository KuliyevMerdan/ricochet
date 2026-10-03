/**
 * A bot's own randomness: mulberry32 over a `u32` state it carries in its memory. Pure — the state
 * goes in, the value and the next state come out — so a bot seeded the same plays the same.
 */
export function next(state: number): readonly [value: number, state: number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [(t ^ (t >>> 14)) >>> 0, s];
}

/** An integer in `[0, n)`, and the next state. */
export function below(state: number, n: number): readonly [value: number, state: number] {
  const [v, s] = next(state);
  return [v % n, s];
}

/** A number in `[0, 1)`, and the next state. */
export function unit(state: number): readonly [value: number, state: number] {
  const [v, s] = next(state);
  return [v / 4294967296, s];
}
