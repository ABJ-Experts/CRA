export type Result<T, E> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export function success<T>(value: T): Result<T, never> {
  return Object.freeze({ ok: true, value });
}

export function failure<E>(error: E): Result<never, E> {
  return Object.freeze({ ok: false, error });
}
