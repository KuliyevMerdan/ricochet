// FIXTURE — lines 3–8 must be rejected by the exactness rules in eslint.config.mjs; 9–11 must not.
export function inexact(a: number, b: number) {
  const s = Math.sin(a);
  const c = Math.cos(a);
  const t = Math.atan2(a, b);
  const p = Math.pow(a, b);
  const h = Math.hypot(a, b);
  const q = a ** 2;
  const r = Math.sqrt(a); // NOT flagged: IEEE 754 square root, correctly rounded everywhere
  const m = Math.min(a, b) * Math.abs(b); // NOT flagged: exact
  const f = Math.floor(a / b); // NOT flagged: exact
  return { s, c, t, p, h, q, r, m, f };
}
