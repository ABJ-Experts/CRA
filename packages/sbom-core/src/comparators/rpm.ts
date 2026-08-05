// RPM ecosystem version comparator (BRD §10).
//
// Implements RPM's real ordering algorithm as found in rpm's lib/rpmvercmp.c
// (rpmvercmp) and lib/rpmds.c / rpmVersionCompare():
//
//   Full version string is "[epoch:]version[-release]".
//     1. Compare EPOCH numerically (a missing epoch is treated as 0).
//     2. Compare VERSION with rpmvercmp.
//     3. Compare RELEASE with rpmvercmp — but only when BOTH sides carry a
//        release, per rpmVersionCompare() (`if (one && two) ...`): a version
//        with no release matches any release.
//
// rpmvercmp walks both strings segment by segment, where a segment is a maximal
// run of digits or a maximal run of ASCII letters; every other byte is a
// separator. A "~" (tilde) sorts before anything, even the empty string; a "^"
// (caret) sorts after when one side has ended; a numeric segment always
// outranks an alphabetic one; numeric segments compare numerically (after
// dropping leading zeros); alphabetic segments compare with strcmp.

export const ECOSYSTEM = "rpm";

const COLON = 0x3a; // ":"
const TILDE = 0x7e; // "~"
const CARET = 0x5e; // "^"
const ZERO = 0x30; // "0"

// rpm's C locale byte classes: digits 0-9, letters A-Z / a-z only.
function isDigitCode(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isAlphaCode(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

function isAlnumCode(c: number): boolean {
  return isDigitCode(c) || isAlphaCode(c);
}

// A separator is anything that is neither alphanumeric nor "~" nor "^".
function isSeparatorCode(c: number): boolean {
  return !isAlnumCode(c) && c !== TILDE && c !== CARET;
}

// strcmp: byte-order comparison. Segments are ASCII, so UTF-16 order matches.
function strcmp(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function stripLeadingZeros(s: string): string {
  let k = 0;
  while (k < s.length && s.charCodeAt(k) === ZERO) k++;
  return s.slice(k);
}

// Numeric segment comparison: "throw away leading zeros", then the string with
// more digits wins, otherwise fall back to strcmp (rpmvercmp numeric branch).
function compareNumeric(a: string, b: string): -1 | 0 | 1 {
  const x = stripLeadingZeros(a);
  const y = stripLeadingZeros(b);
  if (x.length > y.length) return 1;
  if (x.length < y.length) return -1;
  return strcmp(x, y);
}

// Port of rpm's rpmvercmp().
function rpmvercmp(a: string, b: string): -1 | 0 | 1 {
  // "easy comparison to see if versions are identical".
  if (a === b) return 0;

  const la = a.length;
  const lb = b.length;
  let i = 0;
  let j = 0;

  while (i < la || j < lb) {
    // Skip separators on both sides.
    while (i < la && isSeparatorCode(a.charCodeAt(i))) i++;
    while (j < lb && isSeparatorCode(b.charCodeAt(j))) j++;

    // Tilde sorts before everything else, even the empty string.
    const aTilde = i < la && a.charCodeAt(i) === TILDE;
    const bTilde = j < lb && b.charCodeAt(j) === TILDE;
    if (aTilde || bTilde) {
      if (!aTilde) return 1;
      if (!bTilde) return -1;
      i++;
      j++;
      continue;
    }

    // Caret: like tilde, except if one string has ended, the string that still
    // continues (the "^"-suffixed snapshot) is the higher version.
    const aCaret = i < la && a.charCodeAt(i) === CARET;
    const bCaret = j < lb && b.charCodeAt(j) === CARET;
    if (aCaret || bCaret) {
      if (i >= la) return -1;
      if (j >= lb) return 1;
      if (!aCaret) return 1;
      if (!bCaret) return -1;
      i++;
      j++;
      continue;
    }

    // If either string ran to the end, we are finished with the loop.
    if (i >= la || j >= lb) break;

    // Grab the first completely-alpha or completely-numeric segment on each side.
    const startA = i;
    const startB = j;
    const numeric = isDigitCode(a.charCodeAt(i));
    if (numeric) {
      while (i < la && isDigitCode(a.charCodeAt(i))) i++;
      while (j < lb && isDigitCode(b.charCodeAt(j))) j++;
    } else {
      while (i < la && isAlphaCode(a.charCodeAt(i))) i++;
      while (j < lb && isAlphaCode(b.charCodeAt(j))) j++;
    }

    const segA = a.slice(startA, i);
    const segB = b.slice(startB, j);

    // segA is always non-empty here. If segB is empty the segments are of
    // different types: a numeric segment is always newer than an alpha one.
    if (segB.length === 0) return numeric ? 1 : -1;

    const cmp = numeric ? compareNumeric(segA, segB) : strcmp(segA, segB);
    if (cmp !== 0) return cmp;
    // Equal segment — keep comparing.
  }

  // All segments compared equal; whichever string still has characters left
  // over wins (a plain trailing segment, not a "~" pre-release).
  const aLeft = i < la;
  const bLeft = j < lb;
  if (aLeft === bLeft) return 0;
  return aLeft ? 1 : -1;
}

interface Evr {
  epoch: string;
  version: string;
  release: string | null;
}

// Port of rpm's parseEVR(): "[epoch:]version[-release]". The epoch is the
// leading run of digits immediately followed by ":"; the release is everything
// after the LAST "-".
function parseEvr(evr: string): Evr {
  let i = 0;
  while (i < evr.length && isDigitCode(evr.charCodeAt(i))) i++;

  let epoch = "0";
  let rest = evr;
  if (i < evr.length && evr.charCodeAt(i) === COLON) {
    const head = evr.slice(0, i);
    // ":1.0" (empty epoch) is defined by rpm to mean epoch 0.
    epoch = head.length === 0 ? "0" : head;
    rest = evr.slice(i + 1);
  }

  const dash = rest.lastIndexOf("-");
  if (dash >= 0) {
    return {
      epoch,
      version: rest.slice(0, dash),
      release: rest.slice(dash + 1),
    };
  }
  return { epoch, version: rest, release: null };
}

/**
 * Compare two RPM version strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const ea = parseEvr(a);
  const eb = parseEvr(b);

  // 1. Epoch, numerically (absent epoch == 0).
  const epochCmp = compareNumeric(ea.epoch, eb.epoch);
  if (epochCmp !== 0) return epochCmp;

  // 2. Version, via rpmvercmp.
  const versionCmp = rpmvercmp(ea.version, eb.version);
  if (versionCmp !== 0) return versionCmp;

  // 3. Release, via rpmvercmp — only when both sides supply one
  //    (rpmVersionCompare: `if (one && two) rc = rpmvercmp(...)`).
  if (ea.release !== null && eb.release !== null) {
    return rpmvercmp(ea.release, eb.release);
  }
  return 0;
}
