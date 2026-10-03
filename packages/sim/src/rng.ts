/**
 * The world's own randomness: mulberry32 over a `u32` state carried in the world. Pure — the state
 * goes in, the value and the next state come out — so two worlds from one seed draw the same numbers,
 * and a world serialised and restored draws on where it left off.
 */
export function next(state: number): readonly [value: number, state: number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [(t ^ (t >>> 14)) >>> 0, s];
}

/** An integer in `[0, n)`, and the next state. `n` is small here (a handful of spawn points), so
 * the modulo's bias is far below anything a game could show. */
export function below(state: number, n: number): readonly [value: number, state: number] {
  const [v, s] = next(state);
  return [v % n, s];
}
