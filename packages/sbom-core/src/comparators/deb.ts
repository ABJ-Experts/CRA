// Debian version comparator — a faithful port of dpkg's algorithm
// (lib/dpkg/version.c: verrevcmp / order), as specified by deb-version(7) and
// Debian Policy §5.6.12. Version form: [epoch:]upstream[-revision].
//
// Rule (deb-version(7)):
//  - Compare epoch first, numerically; an absent epoch is 0.
//  - Then compare upstream_version, then debian_revision, each with the Debian
//    string algorithm below.
//  - The string is split into alternating non-digit and digit runs. Non-digit
//    runs compare character-by-character via order(); digit runs compare
//    numerically with leading zeros ignored.
//  - order(): letters sort by ASCII value (so all letters sort BEFORE all
//    non-letter punctuation), '~' sorts before everything including the empty
//    string, and end-of-string sorts between '~' and letters. Hence
//    "1.0~rc1" < "1.0".

export const ECOSYSTEM = "deb";

interface DebVersion {
  epoch: number;
  upstream: string;
  revision: string;
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

// order() from dpkg: sort weight of a character within a non-digit run.
// '~' = -1 (before everything, including the empty string whose weight is 0);
// letters = their code point; any other character = code + 256 (after letters).
function order(c: string): number {
  if (c === "") return 0; // end of string
  const code = c.charCodeAt(0);
  if (isDigit(c)) return 0; // never reached: order() is only called on non-digits
  if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) return code; // letters
  if (c === "~") return -1; // tilde sorts before everything
  return code + 256; // other punctuation sorts after letters
}

// Character at index or "" when past the end (mirrors dpkg reading past '\0').
function charAt(s: string, i: number): string {
  return i < s.length ? s[i]! : "";
}

// verrevcmp() from dpkg: compare one segment (upstream or revision) of a
// Debian version. deb-version(7).
function verrevcmp(a: string, b: string): -1 | 0 | 1 {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    // Compare the leading non-digit run character by character.
    while (
      (i < a.length && !isDigit(a[i]!)) ||
      (j < b.length && !isDigit(b[j]!))
    ) {
      const ac = order(charAt(a, i));
      const bc = order(charAt(b, j));
      if (ac !== bc) return ac < bc ? -1 : 1;
      i += 1;
      j += 1;
    }
    // Skip leading zeros so digit runs compare by numeric value.
    while (charAt(a, i) === "0") i += 1;
    while (charAt(b, j) === "0") j += 1;
    // Compare the digit run: the longer remaining run of digits is the larger
    // number; otherwise the first differing digit decides.
    let firstDiff = 0;
    while (i < a.length && isDigit(a[i]!) && j < b.length && isDigit(b[j]!)) {
      if (firstDiff === 0) firstDiff = a.charCodeAt(i) - b.charCodeAt(j);
      i += 1;
      j += 1;
    }
    if (i < a.length && isDigit(a[i]!)) return 1;
    if (j < b.length && isDigit(b[j]!)) return -1;
    if (firstDiff !== 0) return firstDiff < 0 ? -1 : 1;
  }
  return 0;
}

// Parse [epoch:]upstream[-revision] per deb-version(7). The epoch is the digit
// run before the first ':' (0 when absent). The revision is the part after the
// LAST '-' (empty when absent — and an empty revision compares equal to "0").
function parseDebVersion(v: string): DebVersion {
  let rest = v;
  let epoch = 0;
  const colon = rest.indexOf(":");
  if (colon !== -1) {
    epoch = parseInt(rest.slice(0, colon), 10) || 0;
    rest = rest.slice(colon + 1);
  }
  let upstream = rest;
  let revision = "";
  const hyphen = rest.lastIndexOf("-");
  if (hyphen !== -1) {
    upstream = rest.slice(0, hyphen);
    revision = rest.slice(hyphen + 1);
  }
  return { epoch, upstream, revision };
}

// Returns -1 if a < b, 0 if equal, 1 if a > b (deb-version(7) ordering).
export function compare(a: string, b: string): -1 | 0 | 1 {
  const va = parseDebVersion(a);
  const vb = parseDebVersion(b);
  // 1. Epoch, numerically; absent epoch is 0.
  if (va.epoch !== vb.epoch) return va.epoch < vb.epoch ? -1 : 1;
  // 2. upstream_version via the Debian string algorithm.
  const up = verrevcmp(va.upstream, vb.upstream);
  if (up !== 0) return up;
  // 3. debian_revision via the same algorithm.
  return verrevcmp(va.revision, vb.revision);
}
