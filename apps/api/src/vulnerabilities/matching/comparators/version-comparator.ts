/**
 * Comparator boundary used by deterministic vulnerability matching.  A caller
 * must treat `unsupported` as review-required; it is deliberately not a
 * lexical fallback.
 */
export type VersionComparatorId =
  "semver" | "debian" | "rpm" | "maven" | "pep440" | "go";

export type VersionComparison =
  | Readonly<{ kind: "comparable"; ordering: -1 | 0 | 1 }>
  | Readonly<{ kind: "unsupported"; reason: "invalid_version" }>;

export interface VersionComparator {
  readonly id: VersionComparatorId;
  compare(left: string, right: string): VersionComparison;
}

const comparable = (value: number): VersionComparison => ({
  kind: "comparable",
  ordering: value === 0 ? 0 : value < 0 ? -1 : 1,
});
const invalid = (): VersionComparison => ({
  kind: "unsupported",
  reason: "invalid_version",
});

type Semver = Readonly<{
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
}>;

function parseSemver(value: string): Semver | null {
  const match = value
    .trim()
    .match(
      /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    );
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (part) =>
        part === "" ||
        (/^\d+$/.test(part) && part.length > 1 && part.startsWith("0")),
    )
  ) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? "0"),
    patch: Number(match[3] ?? "0"),
    prerelease,
  };
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareSemverValues(left: Semver, right: Semver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    if (a === b) continue;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) return Number(a) < Number(b) ? -1 : 1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return compareText(a, b);
  }
  return 0;
}

const semverComparator: VersionComparator = {
  id: "semver",
  compare(left, right) {
    const parsedLeft = parseSemver(left);
    const parsedRight = parseSemver(right);
    return parsedLeft && parsedRight
      ? comparable(compareSemverValues(parsedLeft, parsedRight))
      : invalid();
  },
};

type DebianVersion = Readonly<{
  epoch: number;
  upstream: string;
  revision: string;
}>;

function parseDebian(value: string): DebianVersion | null {
  const trimmed = value.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  const epochMatch = trimmed.match(/^(\d+):(.*)$/);
  const epoch = Number(epochMatch?.[1] ?? "0");
  const remainder = epochMatch?.[2] ?? trimmed;
  if (!Number.isSafeInteger(epoch) || remainder === "") return null;
  const separator = remainder.lastIndexOf("-");
  return {
    epoch,
    upstream: separator < 0 ? remainder : remainder.slice(0, separator),
    revision: separator < 0 ? "0" : remainder.slice(separator + 1),
  };
}

function debianOrder(char: string | undefined): number {
  if (char === "~") return -1;
  if (char === undefined) return 0;
  const code = char.charCodeAt(0);
  return /[A-Za-z]/.test(char) ? code : code + 256;
}

function compareDebianPart(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    while (
      (left[leftIndex] !== undefined && !/\d/.test(left[leftIndex]!)) ||
      (right[rightIndex] !== undefined && !/\d/.test(right[rightIndex]!))
    ) {
      const order =
        debianOrder(left[leftIndex]) - debianOrder(right[rightIndex]);
      if (order !== 0) return order;
      leftIndex += 1;
      rightIndex += 1;
    }
    const leftStart = leftIndex;
    const rightStart = rightIndex;
    while (/\d/.test(left[leftIndex] ?? "")) leftIndex += 1;
    while (/\d/.test(right[rightIndex] ?? "")) rightIndex += 1;
    const leftDigits = left.slice(leftStart, leftIndex).replace(/^0+/, "");
    const rightDigits = right.slice(rightStart, rightIndex).replace(/^0+/, "");
    if (leftDigits.length !== rightDigits.length) {
      return leftDigits.length < rightDigits.length ? -1 : 1;
    }
    const digits = compareText(leftDigits, rightDigits);
    if (digits !== 0) return digits;
  }
  return 0;
}

const debianComparator: VersionComparator = {
  id: "debian",
  compare(left, right) {
    const parsedLeft = parseDebian(left);
    const parsedRight = parseDebian(right);
    if (!parsedLeft || !parsedRight) return invalid();
    if (parsedLeft.epoch !== parsedRight.epoch) {
      return comparable(parsedLeft.epoch - parsedRight.epoch);
    }
    const upstream = compareDebianPart(
      parsedLeft.upstream,
      parsedRight.upstream,
    );
    return comparable(
      upstream === 0
        ? compareDebianPart(parsedLeft.revision, parsedRight.revision)
        : upstream,
    );
  },
};

type RpmVersion = Readonly<{ epoch: number; version: string; release: string }>;

function parseRpm(value: string): RpmVersion | null {
  const trimmed = value.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  const epochMatch = trimmed.match(/^(\d+):(.*)$/);
  const epoch = Number(epochMatch?.[1] ?? "0");
  const remainder = epochMatch?.[2] ?? trimmed;
  const separator = remainder.lastIndexOf("-");
  const version = separator < 0 ? remainder : remainder.slice(0, separator);
  const release = separator < 0 ? "" : remainder.slice(separator + 1);
  if (!Number.isSafeInteger(epoch) || version === "") return null;
  return { epoch, version, release };
}

function compareRpmPart(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (left[leftIndex] === "~" || right[rightIndex] === "~") {
      if (left[leftIndex] !== right[rightIndex])
        return left[leftIndex] === "~" ? -1 : 1;
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    while (left[leftIndex] && !/[A-Za-z0-9]/.test(left[leftIndex]!))
      leftIndex += 1;
    while (right[rightIndex] && !/[A-Za-z0-9]/.test(right[rightIndex]!))
      rightIndex += 1;
    if (leftIndex >= left.length || rightIndex >= right.length) break;
    const leftNumeric = /\d/.test(left[leftIndex]!);
    const rightNumeric = /\d/.test(right[rightIndex]!);
    if (leftNumeric !== rightNumeric) return leftNumeric ? 1 : -1;
    const numeric = leftNumeric;
    const leftStart = leftIndex;
    const rightStart = rightIndex;
    const pattern = numeric ? /\d/ : /[A-Za-z]/;
    while (pattern.test(left[leftIndex] ?? "")) leftIndex += 1;
    while (pattern.test(right[rightIndex] ?? "")) rightIndex += 1;
    const leftPart = left.slice(leftStart, leftIndex);
    const rightPart = right.slice(rightStart, rightIndex);
    if (numeric) {
      const a = leftPart.replace(/^0+/, "");
      const b = rightPart.replace(/^0+/, "");
      if (a.length !== b.length) return a.length < b.length ? -1 : 1;
      const order = compareText(a, b);
      if (order !== 0) return order;
    } else {
      const order = compareText(leftPart, rightPart);
      if (order !== 0) return order;
    }
  }
  if (leftIndex === left.length && rightIndex === right.length) return 0;
  return leftIndex === left.length ? -1 : 1;
}

const rpmComparator: VersionComparator = {
  id: "rpm",
  compare(left, right) {
    const parsedLeft = parseRpm(left);
    const parsedRight = parseRpm(right);
    if (!parsedLeft || !parsedRight) return invalid();
    if (parsedLeft.epoch !== parsedRight.epoch) {
      return comparable(parsedLeft.epoch - parsedRight.epoch);
    }
    const version = compareRpmPart(parsedLeft.version, parsedRight.version);
    return comparable(
      version === 0
        ? compareRpmPart(parsedLeft.release, parsedRight.release)
        : version,
    );
  },
};

type MavenToken = Readonly<{
  type: "number" | "qualifier";
  value: number | string;
}>;
const mavenQualifierOrder = [
  "alpha",
  "beta",
  "milestone",
  "rc",
  "snapshot",
  "",
  "sp",
] as const;
const mavenQualifierAliases: Readonly<Record<string, string>> = {
  a: "alpha",
  b: "beta",
  m: "milestone",
  cr: "rc",
  final: "",
  ga: "",
  release: "",
};

function mavenTokens(value: string): MavenToken[] | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || !/^[0-9A-Za-z.+_-]+$/.test(trimmed)) return null;
  const parts = trimmed
    .replace(/([0-9])([A-Za-z])/g, "$1.$2")
    .replace(/([A-Za-z])([0-9])/g, "$1.$2")
    .split(/[._+-]+/)
    .filter(Boolean);
  const tokens = parts.map((part): MavenToken => {
    if (/^\d+$/.test(part)) return { type: "number", value: Number(part) };
    return {
      type: "qualifier",
      value: mavenQualifierAliases[part] ?? part,
    };
  });
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1]!;
    if (
      (last.type === "number" && last.value === 0) ||
      (last.type === "qualifier" && last.value === "")
    ) {
      tokens.pop();
    } else {
      break;
    }
  }
  return tokens;
}

function compareMavenQualifier(left: string, right: string): number {
  const leftIndex = mavenQualifierOrder.indexOf(left as never);
  const rightIndex = mavenQualifierOrder.indexOf(right as never);
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
  if (leftIndex >= 0) return -1;
  if (rightIndex >= 0) return 1;
  return compareText(left, right);
}

function compareMavenToken(
  left: MavenToken | undefined,
  right: MavenToken | undefined,
): number {
  if (!left || !right) {
    if (left === right) return 0;
    const present = left ?? right!;
    const order =
      present.type === "number"
        ? Number(present.value)
        : compareMavenQualifier(String(present.value), "");
    return left ? order : -order;
  }
  if (left.type === "number" && right.type === "number") {
    return Number(left.value) - Number(right.value);
  }
  if (left.type === "qualifier" && right.type === "qualifier") {
    return compareMavenQualifier(String(left.value), String(right.value));
  }
  return left.type === "number" ? 1 : -1;
}

const mavenComparator: VersionComparator = {
  id: "maven",
  compare(left, right) {
    const parsedLeft = mavenTokens(left);
    const parsedRight = mavenTokens(right);
    if (!parsedLeft || !parsedRight) return invalid();
    const length = Math.max(parsedLeft.length, parsedRight.length);
    for (let index = 0; index < length; index += 1) {
      const ordering = compareMavenToken(parsedLeft[index], parsedRight[index]);
      if (ordering !== 0) return comparable(ordering);
    }
    return comparable(0);
  },
};

type Pep440 = Readonly<{
  epoch: number;
  release: readonly number[];
  pre: readonly [number, number] | null;
  post: number | null;
  dev: number | null;
  local: readonly (number | string)[] | null;
}>;

function parsePep440(value: string): Pep440 | null {
  const match = value
    .trim()
    .match(
      /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d*)?)?(?:(?:[-_.]?(?:post|rev|r))[-_.]?(\d*)?|-(\d+))?(?:[-_.]?dev[-_.]?(\d*)?)?(?:\+([0-9A-Za-z]+(?:[-_.][0-9A-Za-z]+)*))?$/i,
    );
  if (!match) return null;
  const release = match[2]!.split(".").map(Number);
  while (release.length > 1 && release[release.length - 1] === 0) release.pop();
  const preLabel = match[3]?.toLowerCase();
  const preRank =
    preLabel === undefined
      ? null
      : ({ a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 }[
          preLabel
        ] ?? null);
  if (preLabel !== undefined && preRank === null) return null;
  const parsed = [match[1], match[4], match[5], match[6], match[7]]
    .filter((part): part is string => part !== undefined && part !== "")
    .map(Number);
  if (parsed.some((part) => !Number.isSafeInteger(part))) return null;
  return {
    epoch: Number(match[1] ?? "0"),
    release,
    pre: preRank === null ? null : [preRank, Number(match[4] || "0")],
    post: match[5] || match[6] ? Number(match[5] || match[6]) : null,
    dev: match[7] ? Number(match[7]) : null,
    local: match[8]
      ? match[8]
          .toLowerCase()
          .split(/[-_.]/)
          .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      : null,
  };
}

function compareNumberLists(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const ordering = (left[index] ?? 0) - (right[index] ?? 0);
    if (ordering !== 0) return ordering;
  }
  return 0;
}

function comparePep440Values(left: Pep440, right: Pep440): number {
  if (left.epoch !== right.epoch) return left.epoch - right.epoch;
  const release = compareNumberLists(left.release, right.release);
  if (release !== 0) return release;
  const pre = (value: Pep440): readonly [number, number] => {
    if (value.pre) return value.pre;
    return value.dev === null ? [3, 0] : [-1, 0];
  };
  const preOrder = compareNumberLists(pre(left), pre(right));
  if (preOrder !== 0) return preOrder;
  const postOrder = (left.post ?? -1) - (right.post ?? -1);
  if (postOrder !== 0) return postOrder;
  const devOrder =
    left.dev === null || right.dev === null
      ? left.dev === right.dev
        ? 0
        : left.dev === null
          ? 1
          : -1
      : left.dev - right.dev;
  if (devOrder !== 0) return devOrder;
  if (left.local === null || right.local === null) {
    if (left.local === right.local) return 0;
    return left.local === null ? -1 : 1;
  }
  const length = Math.max(left.local.length, right.local.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.local[index];
    const b = right.local[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return 1;
    if (typeof b === "number") return -1;
    return compareText(a, b);
  }
  return 0;
}

const pep440Comparator: VersionComparator = {
  id: "pep440",
  compare(left, right) {
    const parsedLeft = parsePep440(left);
    const parsedRight = parsePep440(right);
    return parsedLeft && parsedRight
      ? comparable(comparePep440Values(parsedLeft, parsedRight))
      : invalid();
  },
};

const goComparator: VersionComparator = {
  id: "go",
  compare(left, right) {
    const normalize = (value: string) =>
      value.trim().replace(/\+incompatible$/, "");
    const parsedLeft = parseSemver(normalize(left));
    const parsedRight = parseSemver(normalize(right));
    return parsedLeft && parsedRight
      ? comparable(compareSemverValues(parsedLeft, parsedRight))
      : invalid();
  },
};

/** Stored with every finding and golden-dataset run for reproducibility. */
export const VERSION_COMPARATOR_REGISTRY_VERSION = "2026.08.1";

export const VERSION_COMPARATORS: Readonly<
  Record<VersionComparatorId, VersionComparator>
> = {
  semver: semverComparator,
  debian: debianComparator,
  rpm: rpmComparator,
  maven: mavenComparator,
  pep440: pep440Comparator,
  go: goComparator,
};

export function compareVersion(
  comparator: VersionComparatorId,
  left: string,
  right: string,
): VersionComparison {
  return VERSION_COMPARATORS[comparator].compare(left, right);
}
