// Go module version comparator (BRD §10).
//
// Faithful port of golang.org/x/mod/semver (the ordering the Go toolchain and
// module proxy actually use). Go versions are SemVer with a REQUIRED leading
// "v" (e.g. "v1.2.3"). Precedence is standard SemVer precedence:
//   - major, then minor, then patch compared as integers (no leading zeros);
//   - a pre-release version has LOWER precedence than the release
//     ("v1.2.3-pre" < "v1.2.3");
//   - BUILD METADATA ("+...") is IGNORED for ordering — this includes Go's
//     "+incompatible" suffix, which must parse but never affect the result.
//
// Reference: https://pkg.go.dev/golang.org/x/mod/semver (semver.Compare) and
// https://semver.org/#spec-item-11.

export const ECOSYSTEM = "go";

// ASCII code points used by the parser/classifier helpers.
const CODE_0 = 48; // "0"
const CODE_9 = 57; // "9"
const CODE_UPPER_A = 65; // "A"
const CODE_UPPER_Z = 90; // "Z"
const CODE_LOWER_A = 97; // "a"
const CODE_LOWER_Z = 122; // "z"
const CODE_LOWER_V = 118; // "v"
const CODE_PLUS = 43; // "+"
const CODE_DASH = 45; // "-"
const CODE_DOT = 46; // "."

interface Parsed {
  major: string;
  minor: string;
  patch: string;
  // Pre-release identifiers, INCLUDING the leading "-" (or "" when absent).
  prerelease: string;
  // Build metadata, INCLUDING the leading "+" (or "" when absent). Parsed but
  // deliberately ignored by compare().
  build: string;
}

function isDigitCode(c: number): boolean {
  return c >= CODE_0 && c <= CODE_9;
}

// SemVer identifier char class: [0-9A-Za-z-] (x/mod/semver: isIdentChar).
function isIdentCharCode(c: number): boolean {
  return (
    isDigitCode(c) ||
    (c >= CODE_UPPER_A && c <= CODE_UPPER_Z) ||
    (c >= CODE_LOWER_A && c <= CODE_LOWER_Z) ||
    c === CODE_DASH
  );
}

// Numeric identifier check (x/mod/semver: isNum). "" counts as numeric, matching
// the upstream helper; callers only pass non-empty identifiers.
function isNum(v: string): boolean {
  let i = 0;
  while (i < v.length && isDigitCode(v.charCodeAt(i))) i += 1;
  return i === v.length;
}

// A purely-numeric identifier with a disallowed leading zero, e.g. "01"
// (x/mod/semver: isBadNum). Used to reject illegal pre-release fields.
function isBadNum(v: string): boolean {
  let i = 0;
  while (i < v.length && isDigitCode(v.charCodeAt(i))) i += 1;
  return i === v.length && i > 1 && v.charCodeAt(0) === CODE_0;
}

// Parse one numeric version field. Leading zeros are illegal ("0" ok, "01" not),
// so the returned digit string can be length-compared as an integer later
// (x/mod/semver: parseInt).
function parseNumericField(v: string): { value: string; rest: string } | null {
  const first = v.charCodeAt(0); // NaN for "" -> not a digit
  if (!isDigitCode(first)) return null;
  let i = 1;
  while (i < v.length && isDigitCode(v.charCodeAt(i))) i += 1;
  if (first === CODE_0 && i !== 1) return null; // no leading zeros
  return { value: v.slice(0, i), rest: v.slice(i) };
}

// Parse the "-pre.release" segment (x/mod/semver: parsePrerelease). Stops at "+"
// (start of build metadata) or end of string. Each dot-separated identifier must
// be non-empty and, if numeric, free of leading zeros.
function parsePrerelease(v: string): { value: string; rest: string } | null {
  if (v.charCodeAt(0) !== CODE_DASH) return null;
  let i = 1;
  let start = 1;
  while (i < v.length && v.charCodeAt(i) !== CODE_PLUS) {
    const c = v.charCodeAt(i);
    if (!isIdentCharCode(c) && c !== CODE_DOT) return null;
    if (c === CODE_DOT) {
      if (start === i || isBadNum(v.slice(start, i))) return null;
      start = i + 1;
    }
    i += 1;
  }
  if (start === i || isBadNum(v.slice(start, i))) return null;
  return { value: v.slice(0, i), rest: v.slice(i) };
}

// Parse the "+build.metadata" segment (x/mod/semver: parseBuild). Runs to end of
// string; identifiers must be non-empty but may contain leading zeros. The value
// is retained only so parsing succeeds — it never affects ordering. This is what
// makes Go's "+incompatible" suffix parse cleanly and compare as equal.
function parseBuild(v: string): { value: string; rest: string } | null {
  if (v.charCodeAt(0) !== CODE_PLUS) return null;
  let i = 1;
  let start = 1;
  while (i < v.length) {
    const c = v.charCodeAt(i);
    if (!isIdentCharCode(c) && c !== CODE_DOT) return null;
    if (c === CODE_DOT) {
      if (start === i) return null;
      start = i + 1;
    }
    i += 1;
  }
  if (start === i) return null;
  return { value: v.slice(0, i), rest: v.slice(i) };
}

// Parse a full Go version string (x/mod/semver: parse). Missing minor/patch
// fields default to "0" ("v1" == "v1.0.0"). golang.org/x/mod/semver REQUIRES a
// leading "v"; we accept a missing "v" leniently by treating the input as if it
// were v-prefixed. That is a defined, total behaviour: both operands are
// normalised identically, so ordering stays anti-symmetric.
function parse(input: string): Parsed | null {
  const withV = input.charCodeAt(0) === CODE_LOWER_V ? input : "v" + input;
  let rest = withV.slice(1); // drop the leading "v"

  const major = parseNumericField(rest);
  if (major === null) return null;
  rest = major.rest;
  if (rest === "") {
    return {
      major: major.value,
      minor: "0",
      patch: "0",
      prerelease: "",
      build: "",
    };
  }
  if (rest.charCodeAt(0) !== CODE_DOT) return null;

  const minor = parseNumericField(rest.slice(1));
  if (minor === null) return null;
  rest = minor.rest;
  if (rest === "") {
    return {
      major: major.value,
      minor: minor.value,
      patch: "0",
      prerelease: "",
      build: "",
    };
  }
  if (rest.charCodeAt(0) !== CODE_DOT) return null;

  const patch = parseNumericField(rest.slice(1));
  if (patch === null) return null;
  rest = patch.rest;

  let prerelease = "";
  if (rest.charCodeAt(0) === CODE_DASH) {
    const pr = parsePrerelease(rest);
    if (pr === null) return null;
    prerelease = pr.value;
    rest = pr.rest;
  }

  let build = "";
  if (rest.charCodeAt(0) === CODE_PLUS) {
    const b = parseBuild(rest);
    if (b === null) return null;
    build = b.value;
    rest = b.rest;
  }

  if (rest !== "") return null; // trailing garbage -> invalid
  return {
    major: major.value,
    minor: minor.value,
    patch: patch.value,
    prerelease,
    build,
  };
}

// Compare two version fields as integers (x/mod/semver: compareInt). Inputs have
// no leading zeros, so a longer digit string is the larger number.
function compareInt(x: string, y: string): -1 | 0 | 1 {
  if (x === y) return 0;
  if (x.length < y.length) return -1;
  if (x.length > y.length) return 1;
  return x < y ? -1 : 1;
}

// Split off the next dot-separated identifier (x/mod/semver: nextIdent).
function nextIdent(x: string): { ident: string; rest: string } {
  let i = 0;
  while (i < x.length && x.charCodeAt(i) !== CODE_DOT) i += 1;
  return { ident: x.slice(0, i), rest: x.slice(i) };
}

// Compare pre-release strings (each including its leading "-"), per SemVer §11
// and x/mod/semver: comparePrerelease.
//   - An empty pre-release (a release) has HIGHER precedence than any non-empty
//     pre-release.
//   - Field by field: numeric identifiers rank below alphanumeric ones; numeric
//     fields compare by magnitude; alphanumeric fields compare in ASCII order.
//   - When all shared fields are equal, the version with MORE fields is greater.
function comparePrerelease(xIn: string, yIn: string): -1 | 0 | 1 {
  if (xIn === yIn) return 0;
  if (xIn === "") return 1; // release > pre-release
  if (yIn === "") return -1;

  let x = xIn;
  let y = yIn;
  while (x !== "" && y !== "") {
    x = x.slice(1); // skip the leading "-" (first iter) or "." (later iters)
    y = y.slice(1);
    const nx = nextIdent(x);
    const ny = nextIdent(y);
    x = nx.rest;
    y = ny.rest;
    const dx = nx.ident;
    const dy = ny.ident;
    if (dx !== dy) {
      const ix = isNum(dx);
      const iy = isNum(dy);
      if (ix !== iy) {
        return ix ? -1 : 1; // numeric < alphanumeric
      }
      if (ix) {
        if (dx.length < dy.length) return -1;
        if (dx.length > dy.length) return 1;
      }
      return dx < dy ? -1 : 1;
    }
  }
  // All compared fields were equal: the longer identifier list wins.
  return x === "" ? -1 : 1;
}

/**
 * Compare two Go module versions.
 * @returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);

  // x/mod/semver: invalid versions sort below valid ones; two invalids are
  // equal. Keeps the relation total and anti-symmetric.
  if (pa === null && pb === null) return 0;
  if (pa === null) return -1;
  if (pb === null) return 1;

  const cMajor = compareInt(pa.major, pb.major);
  if (cMajor !== 0) return cMajor;
  const cMinor = compareInt(pa.minor, pb.minor);
  if (cMinor !== 0) return cMinor;
  const cPatch = compareInt(pa.patch, pb.patch);
  if (cPatch !== 0) return cPatch;

  // Build metadata (pa.build / pb.build), incl. "+incompatible", is ignored.
  return comparePrerelease(pa.prerelease, pb.prerelease);
}
