/** A decode's answer: a value, or why not. Malformed input is a value here, never a throw. */
export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(reason: string): Result<T> {
  return { ok: false, reason };
}
