// Semantic Versioning 2.0.0 comparator (https://semver.org, BRD §10).
// Deterministic: implements the SemVer precedence rules exactly, no guessing.
export const ECOSYSTEM = "semver";

interface Parsed {
  // MAJOR.MINOR.PATCH parsed as non-negative integers (§2).
  readonly release: readonly number[];
  // Pre-release identifiers, or null when the version is a normal release.
  // null sorts HIGHER than any pre-release set (§9, §11.3).
  readonly pre: readonly string[] | null;
}

// §9: build metadata (everything from the first "+") MUST be ignored in precedence.
function stripBuildMetadata(version: string): string {
  const plus = version.indexOf("+");
  return plus === -1 ? version : version.slice(0, plus);
}

// Accept an optional leading "v" (e.g. "v1.2.3"); tooling convention, not part
// of the grammar, so it must not affect precedence.
function stripLeadingV(version: string): string {
  return version.replace(/^v(?=\d)/, "");
}

// A digit segment → integer; malformed/empty segments degrade to 0 rather than NaN
// so comparison stays total and deterministic.
function toInt(segment: string): number {
  const n = Number.parseInt(segment, 10);
  return Number.isNaN(n) ? 0 : n;
}

function parse(version: string): Parsed {
  const clean = stripBuildMetadata(stripLeadingV(version.trim()));
  // The first "-" separates the version core from the pre-release (§9). The core
  // never contains "-", so indexOf is correct here.
  const dash = clean.indexOf("-");
  const core = dash === -1 ? clean : clean.slice(0, dash);
  const preRaw = dash === -1 ? null : clean.slice(dash + 1);
  return {
    release: core.split(".").map(toInt),
    pre: preRaw === null ? null : preRaw.split("."),
  };
}

// §11.2: precedence is determined by comparing MAJOR, then MINOR, then PATCH
// numerically. (This is the trap: "1.10.0" > "1.9.0" numerically, not by string.)
function compareRelease(
  a: readonly number[],
  b: readonly number[],
): -1 | 0 | 1 {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

const NUMERIC = /^[0-9]+$/;

// §11.4.1: an identifier composed of only digits is a numeric identifier.
function isNumericIdentifier(id: string): boolean {
  return NUMERIC.test(id);
}

// §11.4.1: numeric identifiers are compared numerically. Compared as digit
// strings (leading zeros stripped) to stay correct for arbitrarily large values.
function compareNumeric(a: string, b: string): -1 | 0 | 1 {
  const na = a.replace(/^0+(?=\d)/, "");
  const nb = b.replace(/^0+(?=\d)/, "");
  if (na.length !== nb.length) return na.length < nb.length ? -1 : 1;
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

function compareIdentifier(a: string, b: string): -1 | 0 | 1 {
  const aNum = isNumericIdentifier(a);
  const bNum = isNumericIdentifier(b);
  // §11.4.3: numeric identifiers ALWAYS have lower precedence than alphanumeric.
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  // §11.4.1: both numeric → compare numerically.
  if (aNum && bNum) return compareNumeric(a, b);
  // §11.4.2: both alphanumeric → compare lexically in ASCII sort order. JS string
  // comparison is by UTF-16 code unit, which matches ASCII order for these chars.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function comparePreRelease(
  a: readonly string[] | null,
  b: readonly string[] | null,
): -1 | 0 | 1 {
  // §11.3: a pre-release version has LOWER precedence than the associated normal
  // version (null = normal release, which therefore sorts higher).
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  // §11.4: compare identifiers left to right until a difference is found.
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const cmp = compareIdentifier(a[i]!, b[i]!);
    if (cmp !== 0) return cmp;
  }
  // §11.4.4: a larger set of pre-release fields has higher precedence when all
  // preceding identifiers are equal (e.g. 1.0.0-alpha < 1.0.0-alpha.1).
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/** Compare two SemVer strings; -1 if a<b, 0 if equal precedence, 1 if a>b. */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  const releaseCmp = compareRelease(pa.release, pb.release);
  if (releaseCmp !== 0) return releaseCmp;
  return comparePreRelease(pa.pre, pb.pre);
}
