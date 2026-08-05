// PEP 440 version comparator (BRD §10).
//
// Implements the ordering defined by Python's PEP 440 and the reference
// `packaging.version` implementation. A version has the full form:
//   [N!]N(.N)*[{a|b|rc}N][.postN][.devN][+local]
// and versions are ordered by the tuple:
//   (epoch, release, pre, post, dev, local)
// with the sentinel rules from `packaging._cmpkey`:
//   - a bare `.devN` (no pre, no post) sorts BEFORE any pre-release
//   - absence of a pre-release sorts AFTER any pre-release
//   - absence of a post-release sorts BEFORE any post-release
//   - absence of a dev-release sorts AFTER any dev-release
//   - absence of a local version sorts BEFORE any local version
// Net release-line ordering:  .devN  <  {a|b|rc}N  <  release  <  .postN.

export const ECOSYSTEM = "pep440";

type LocalSegment = number | string;

interface Pep440Version {
  epoch: number;
  release: number[];
  // Pre-release letter normalised to one of "a" | "b" | "rc", plus its number.
  pre: readonly [string, number] | null;
  post: number | null;
  dev: number | null;
  local: readonly LocalSegment[] | null;
}

// PEP 440 canonical VERSION_PATTERN (re.VERBOSE | re.IGNORECASE), anchored and
// allowing surrounding whitespace. Named groups mirror the reference grammar.
const VERSION_RE = new RegExp(
  "^\\s*v?" +
    "(?:" +
    "(?:(?<epoch>[0-9]+)!)?" + // epoch: "N!"
    "(?<release>[0-9]+(?:\\.[0-9]+)*)" + // release: N(.N)*
    // pre-release: separator + spelling + optional number
    "(?<pre>[-_.]?(?<preL>a|b|c|rc|alpha|beta|pre|preview)[-_.]?(?<preN>[0-9]+)?)?" +
    // post-release: implicit "-N" form OR "post|rev|r" + optional number
    "(?<post>(?:-(?<postN1>[0-9]+))|(?:[-_.]?(?<postL>post|rev|r)[-_.]?(?<postN2>[0-9]+)?))?" +
    // dev-release: separator + "dev" + optional number
    "(?<dev>[-_.]?(?<devL>dev)[-_.]?(?<devN>[0-9]+)?)?" +
    ")" +
    // local version: "+" then dot/dash/underscore separated alphanumerics
    "(?:\\+(?<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?" +
    "\\s*$",
  "i",
);

// PEP 440 normalisation: alpha->a, beta->b, c|pre|preview->rc (case-insensitive).
function normalisePreLetter(letter: string): string {
  const l = letter.toLowerCase();
  if (l === "alpha") return "a";
  if (l === "beta") return "b";
  if (l === "c" || l === "pre" || l === "preview") return "rc";
  return l; // already "a", "b", or "rc"
}

// Local segments: numeric segments are integers (leading zeros dropped),
// non-numeric segments are lower-cased strings (local versions are case-folded).
function parseLocal(local: string): LocalSegment[] {
  return local
    .split(/[-_.]/)
    .map((seg) =>
      /^[0-9]+$/.test(seg) ? parseInt(seg, 10) : seg.toLowerCase(),
    );
}

// Post number: "-N" implicit form, or explicit "post|rev|r" (implicit 0), else none.
function parsePost(
  postN1: string | undefined,
  postL: string | undefined,
  postN2: string | undefined,
): number | null {
  if (postN1 !== undefined) return parseInt(postN1, 10);
  if (postL !== undefined)
    return postN2 !== undefined ? parseInt(postN2, 10) : 0;
  return null;
}

function parse(version: string): Pep440Version {
  const match = VERSION_RE.exec(version);
  const g = match?.groups;
  if (!match || !g) {
    throw new Error(`Invalid PEP 440 version: ${JSON.stringify(version)}`);
  }
  const epoch = g.epoch !== undefined ? parseInt(g.epoch, 10) : 0;
  // Release always present when the pattern matches; integer-normalise each part.
  const release = g.release!.split(".").map((n) => parseInt(n, 10));
  const pre: readonly [string, number] | null =
    g.preL !== undefined
      ? [
          normalisePreLetter(g.preL),
          g.preN !== undefined ? parseInt(g.preN, 10) : 0,
        ]
      : null;
  const dev =
    g.devL !== undefined
      ? g.devN !== undefined
        ? parseInt(g.devN, 10)
        : 0
      : null;
  const local = g.local !== undefined ? parseLocal(g.local) : null;
  return {
    epoch,
    release,
    pre,
    post: parsePost(g.postN1, g.postL, g.postN2),
    dev,
    local,
  };
}

function cmpNum(a: number, b: number): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Release comparison ignores trailing zeros (1.0 == 1.0.0), then compares
// element-wise; when one is a prefix of the other, the shorter sorts first.
function trimTrailingZeros(release: number[]): number[] {
  let end = release.length;
  while (end > 0 && release[end - 1] === 0) end--;
  return release.slice(0, end);
}

function cmpRelease(a: number[], b: number[]): -1 | 0 | 1 {
  const ra = trimTrailingZeros(a);
  const rb = trimTrailingZeros(b);
  const len = Math.min(ra.length, rb.length);
  for (let i = 0; i < len; i++) {
    const c = cmpNum(ra[i]!, rb[i]!);
    if (c !== 0) return c;
  }
  return cmpNum(ra.length, rb.length);
}

// Pre-release rank (packaging._cmpkey): -1 => -inf (bare .dev), 1 => +inf (no
// pre), 0 => an actual pre tuple. So .devN < pre-releases < plain release.
function preRank(v: Pep440Version): -1 | 0 | 1 {
  if (v.pre === null && v.post === null && v.dev !== null) return -1;
  if (v.pre === null) return 1;
  return 0;
}

function cmpPre(a: Pep440Version, b: Pep440Version): -1 | 0 | 1 {
  const ra = preRank(a);
  const rb = preRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra !== 0) return 0; // same sentinel (-inf or +inf) on both sides
  const [la, na] = a.pre!;
  const [lb, nb] = b.pre!;
  // Letters "a" < "b" < "rc" hold lexicographically, matching a < b < rc.
  if (la !== lb) return la < lb ? -1 : 1;
  return cmpNum(na, nb);
}

// Absent post sorts BEFORE any post (post is -inf when missing).
function cmpPost(a: Pep440Version, b: Pep440Version): -1 | 0 | 1 {
  if (a.post === null && b.post === null) return 0;
  if (a.post === null) return -1;
  if (b.post === null) return 1;
  return cmpNum(a.post, b.post);
}

// Absent dev sorts AFTER any dev (dev is +inf when missing).
function cmpDev(a: Pep440Version, b: Pep440Version): -1 | 0 | 1 {
  if (a.dev === null && b.dev === null) return 0;
  if (a.dev === null) return 1;
  if (b.dev === null) return -1;
  return cmpNum(a.dev, b.dev);
}

// Within a local version: alphanumeric (string) segments sort BEFORE numeric
// segments; strings compare lexicographically, numbers numerically.
function cmpLocalSeg(a: LocalSegment, b: LocalSegment): -1 | 0 | 1 {
  const aNum = typeof a === "number";
  const bNum = typeof b === "number";
  if (aNum && bNum) return cmpNum(a, b);
  if (!aNum && !bNum) return a < b ? -1 : a > b ? 1 : 0;
  return aNum ? 1 : -1; // numeric segment outranks string segment
}

// Absent local sorts BEFORE any local (local is -inf when missing).
function cmpLocal(a: Pep440Version, b: Pep440Version): -1 | 0 | 1 {
  const la = a.local;
  const lb = b.local;
  if (la === null && lb === null) return 0;
  if (la === null) return -1;
  if (lb === null) return 1;
  const len = Math.min(la.length, lb.length);
  for (let i = 0; i < len; i++) {
    const c = cmpLocalSeg(la[i]!, lb[i]!);
    if (c !== 0) return c;
  }
  return cmpNum(la.length, lb.length);
}

// Returns -1 if a < b, 0 if equal, 1 if a > b (PEP 440 ordering).
export function compare(a: string, b: string): -1 | 0 | 1 {
  const va = parse(a);
  const vb = parse(b);
  const epoch = cmpNum(va.epoch, vb.epoch);
  if (epoch !== 0) return epoch;
  const release = cmpRelease(va.release, vb.release);
  if (release !== 0) return release;
  const pre = cmpPre(va, vb);
  if (pre !== 0) return pre;
  const post = cmpPost(va, vb);
  if (post !== 0) return post;
  const dev = cmpDev(va, vb);
  if (dev !== 0) return dev;
  return cmpLocal(va, vb);
}
