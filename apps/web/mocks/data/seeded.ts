/**
 * Deterministic pseudo-random source.
 *
 * Generated rows must be identical on every run and in every environment.
 * `Math.random()` would give each reload a different table, which makes any
 * visual comparison against the Pencil frames meaningless and turns a
 * screenshot diff into noise. It would also disagree between the server
 * render and the client, since MSW runs in both.
 *
 * mulberry32: small, fast, good enough distribution for demo data.
 */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)] as T;
}

export function intBetween(rand: () => number, min: number, max: number): number {
  return Math.floor(min + rand() * (max - min + 1));
}

/** Formats to the frames' own conventions, e.g. `$12,593` and `$928.41`. */
export const money = (n: number, dp = 0) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export const percent = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
