// Apache Maven version comparator (BRD §10).
//
// Faithful port of org.apache.maven.artifact.versioning.ComparableVersion.
// The version string is lowercased, split on "." and "-" and at every
// digit<->letter transition into a tree of items, trailing "null" items are
// normalised away, then the two trees are compared item-by-item.
//
// Item kinds (Maven's Item hierarchy):
//   int    -> numeric token (Maven: IntItem/LongItem/BigIntegerItem)
//   string -> qualifier token (Maven: StringItem)
//   list   -> nested list opened at "-" and at digit<->letter transitions
//
// Maven splits numerics into IntItem/LongItem/BigIntegerItem purely as an
// optimisation and orders a "wider" numeric type above a "narrower" one. Because
// leading zeroes are stripped, a numeric needing more storage always has strictly
// more significant digits and is therefore strictly larger — so a single BigInt
// comparison is provably equivalent and is what we use here.

export const ECOSYSTEM = "maven";

// Maven StringItem.QUALIFIERS — the known-qualifier order. "" is the RELEASE
// (no qualifier); indices are compared as STRINGS (see comparableQualifier).
const QUALIFIERS: readonly string[] = [
  "alpha",
  "beta",
  "milestone",
  "rc",
  "snapshot",
  "",
  "sp",
];

// Maven StringItem.ALIASES — folded before ordering.
const ALIASES: Readonly<Record<string, string>> = {
  ga: "",
  final: "",
  release: "",
  cr: "rc",
};

// Maven RELEASE_VERSION_INDEX = String.valueOf(QUALIFIERS.indexOf("")).
const RELEASE_INDEX = String(QUALIFIERS.indexOf(""));

interface IntItem {
  readonly kind: "int";
  readonly value: bigint;
}

interface StringItem {
  readonly kind: "string";
  readonly value: string;
}

interface ListItem {
  readonly kind: "list";
  readonly items: Item[];
}

type Item = IntItem | StringItem | ListItem;

function zeroInt(): IntItem {
  return { kind: "int", value: 0n };
}

// Maven StringItem.comparableQualifier: known qualifier -> its index as a
// string; unknown qualifier -> "<size>-<qualifier>" so it sorts after "sp".
// Compared with String ordering, matching Maven exactly.
function comparableQualifier(qualifier: string): string {
  const i = QUALIFIERS.indexOf(qualifier);
  return i === -1 ? `${QUALIFIERS.length}-${qualifier}` : String(i);
}

// Maven StringItem constructor: "a"/"b"/"m" followed by a digit expand to
// alpha/beta/milestone; then aliases are folded. Input is already lowercased.
function makeStringItem(
  rawValue: string,
  followedByDigit: boolean,
): StringItem {
  let value = rawValue;
  if (followedByDigit && value.length === 1) {
    if (value === "a") {
      value = "alpha";
    } else if (value === "b") {
      value = "beta";
    } else if (value === "m") {
      value = "milestone";
    }
  }
  value = ALIASES[value] ?? value;
  return { kind: "string", value };
}

// Maven parseItem: a digit token becomes a numeric item (BigInt so precision is
// exact for arbitrarily long tokens); otherwise a string/qualifier item.
function parseItem(isDigit: boolean, buf: string): Item {
  if (isDigit) {
    // BigInt ignores leading zeroes, matching Maven's stripLeadingZeroes.
    return { kind: "int", value: BigInt(buf) };
  }
  return makeStringItem(buf, false);
}

// Maven Item.isNull: numeric 0, the RELEASE qualifier (""), or an empty list.
// These are the "null" trailing items normalisation strips, which is why
// "1" == "1.0" == "1.0.0" and "1ga" == "1".
function isNull(item: Item): boolean {
  switch (item.kind) {
    case "int":
      return item.value === 0n;
    case "string":
      return comparableQualifier(item.value) === RELEASE_INDEX;
    case "list":
      return item.items.length === 0;
  }
}

// Maven ListItem.normalize: drop trailing null items; stop at the first
// non-null, non-list item.
function normalize(list: ListItem): void {
  for (let i = list.items.length - 1; i >= 0; i--) {
    const last = list.items[i];
    if (last === undefined) {
      continue;
    }
    if (isNull(last)) {
      list.items.splice(i, 1);
    } else if (last.kind !== "list") {
      break;
    }
  }
}

// Maven ComparableVersion.parseVersion. Returns the root list item.
function parse(versionRaw: string): ListItem {
  const version = versionRaw.toLowerCase();
  const root: ListItem = { kind: "list", items: [] };
  const stack: ListItem[] = [root];
  let current: ListItem = root;
  let isDigit = false;
  let startIndex = 0;

  const openSublist = (): ListItem => {
    const sub: ListItem = { kind: "list", items: [] };
    current.items.push(sub);
    stack.push(sub);
    return sub;
  };

  for (let i = 0; i < version.length; i++) {
    const c = version.charAt(i);
    if (c === ".") {
      current.items.push(
        i === startIndex
          ? zeroInt()
          : parseItem(isDigit, version.substring(startIndex, i)),
      );
      startIndex = i + 1;
    } else if (c === "-") {
      current.items.push(
        i === startIndex
          ? zeroInt()
          : parseItem(isDigit, version.substring(startIndex, i)),
      );
      startIndex = i + 1;
      current = openSublist();
    } else if (c >= "0" && c <= "9") {
      if (!isDigit && i > startIndex) {
        // letter -> digit: treat a trailing ".X" like "-X" (Maven comment:
        // 1.0.0.X1 < 1.0.0-X2) by wrapping the preceding token in a new list.
        if (current.items.length > 0) {
          current = openSublist();
        }
        current.items.push(
          makeStringItem(version.substring(startIndex, i), true),
        );
        startIndex = i;
        current = openSublist();
      }
      isDigit = true;
    } else {
      if (isDigit && i > startIndex) {
        // digit -> letter: close the numeric token, open a new list.
        current.items.push(parseItem(true, version.substring(startIndex, i)));
        startIndex = i;
        current = openSublist();
      }
      isDigit = false;
    }
  }

  if (version.length > startIndex) {
    current.items.push(parseItem(isDigit, version.substring(startIndex)));
  }

  // Maven pops the stack (LIFO): innermost lists normalise before their parents.
  for (let s = stack.length - 1; s >= 0; s--) {
    const list = stack[s];
    if (list !== undefined) {
      normalize(list);
    }
  }

  return root;
}

function bigintCompare(a: bigint, b: bigint): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Java String.compareTo is UTF-16 code-unit lexicographic; JS "<"/">" on strings
// is identical for the ASCII qualifier keys used here.
function strCompare(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

function negate(n: -1 | 0 | 1): -1 | 0 | 1 {
  return n === 1 ? -1 : n === -1 ? 1 : 0;
}

// Maven IntItem.compareTo.
function compareIntTo(left: IntItem, right: Item | null): -1 | 0 | 1 {
  if (right === null) {
    return left.value === 0n ? 0 : 1;
  }
  switch (right.kind) {
    case "int":
      return bigintCompare(left.value, right.value);
    case "string":
      return 1; // 1.1 > 1-sp: numeric newer than a qualifier at same position
    case "list":
      return 1; // 1.1 > 1-1
  }
}

// Maven StringItem.compareTo.
function compareStringTo(left: StringItem, right: Item | null): -1 | 0 | 1 {
  if (right === null) {
    return strCompare(comparableQualifier(left.value), RELEASE_INDEX);
  }
  switch (right.kind) {
    case "int":
      return -1; // 1-sp < 1.1
    case "string":
      return strCompare(
        comparableQualifier(left.value),
        comparableQualifier(right.value),
      );
    case "list":
      return -1; // 1-sp < 1-1
  }
}

// Maven ListItem.compareTo.
function compareListTo(left: ListItem, right: Item | null): -1 | 0 | 1 {
  if (right === null) {
    for (const item of left.items) {
      const result = compareItem(item, null);
      if (result !== 0) {
        return result;
      }
    }
    return 0;
  }
  switch (right.kind) {
    case "int":
      return -1; // 1-1 < 1.1
    case "string":
      return 1; // 1-1 > 1-sp
    case "list": {
      const leftItems = left.items;
      const rightItems = right.items;
      const max = Math.max(leftItems.length, rightItems.length);
      for (let i = 0; i < max; i++) {
        const l = i < leftItems.length ? leftItems[i] : null;
        const r = i < rightItems.length ? rightItems[i] : null;
        // A shorter list compares its missing slot against the other's item as
        // (missing) vs item = -(item vs missing), per Maven.
        let result: -1 | 0 | 1;
        if (l === undefined || l === null) {
          result =
            r === undefined || r === null ? 0 : negate(compareItem(r, null));
        } else {
          result = compareItem(l, r ?? null);
        }
        if (result !== 0) {
          return result;
        }
      }
      return 0;
    }
  }
}

function compareItem(left: Item, right: Item | null): -1 | 0 | 1 {
  switch (left.kind) {
    case "int":
      return compareIntTo(left, right);
    case "string":
      return compareStringTo(left, right);
    case "list":
      return compareListTo(left, right);
  }
}

/**
 * Compare two Maven version strings.
 * @returns -1 if a < b, 0 if equal, 1 if a > b (Apache Maven ComparableVersion).
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  return compareListTo(parse(a), parse(b));
}
