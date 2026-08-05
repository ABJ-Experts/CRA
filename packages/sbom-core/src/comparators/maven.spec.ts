import { describe, it, expect } from "vitest";
import { compare } from "./maven";

// All cases are hand-verified against Apache Maven's ComparableVersion algorithm
// and drawn from its own ComparableVersionTest (testVersionsEqual /
// testVersionQualifiers / testVersionNumbers) plus the BRD §10.3 trap row.

describe("maven comparator — §10.3 trap row", () => {
  it("treats 1.0 and 1.0.0 as EQUAL (unlike semver)", () => {
    expect(compare("1.0", "1.0.0")).toBe(0);
    expect(compare("1.0.0", "1.0")).toBe(0);
  });

  it("orders pre-release and RELEASE around the trap version", () => {
    expect(compare("1.0-alpha", "1.0")).toBe(-1); // qualifier < release
    expect(compare("1.0-SNAPSHOT", "1.0")).toBe(-1); // snapshot < release
    expect(compare("1.0-rc1", "1.0")).toBe(-1); // rc < release
    expect(compare("1.0", "1.0-sp")).toBe(-1); // release < sp
    expect(compare("1.0.1", "1.0")).toBe(1); // newer patch > release
  });
});

describe("maven comparator — equalities (normalisation & aliases)", () => {
  const equalPairs: ReadonlyArray<readonly [string, string]> = [
    ["1", "1.0"],
    ["1", "1.0.0"],
    ["1", "1-0"], // trailing null list normalised away
    ["1.0", "1.0-0"],
    ["1a", "1-a"], // no separator between number and qualifier
    ["1a", "1.0.0-a"],
    ["1cr", "1rc"], // "cr" is an alias of "rc"
    ["1ga", "1"], // "ga" folds to RELEASE
    ["1release", "1"], // "release" folds to RELEASE
    ["1final", "1"], // "final" folds to RELEASE
    ["1a1", "1-alpha-1"], // "a"+digit expands to alpha
    ["1b2", "1-beta-2"], // "b"+digit expands to beta
    ["1m3", "1-milestone-3"], // "m"+digit expands to milestone
    ["1X", "1x"], // case-insensitive qualifier
    ["1RELEASE", "1"], // case-insensitive alias
  ];

  it.each(equalPairs)("compare(%s, %s) === 0", (a, b) => {
    expect(compare(a, b)).toBe(0);
    expect(compare(b, a)).toBe(0);
  });
});

describe("maven comparator — known qualifier ordering", () => {
  // alpha < beta < milestone < rc(=cr) < snapshot < RELEASE < sp
  const ascending = [
    "1-alpha",
    "1-beta",
    "1-milestone",
    "1-rc",
    "1-snapshot",
    "1", // the RELEASE
    "1-sp",
  ];

  it("is strictly ascending across the qualifier ladder", () => {
    for (let i = 0; i + 1 < ascending.length; i++) {
      const lo = ascending[i]!;
      const hi = ascending[i + 1]!;
      expect(compare(lo, hi)).toBe(-1);
      expect(compare(hi, lo)).toBe(1);
    }
  });

  it("orders same-qualifier numeric suffixes and cr/rc aliases", () => {
    expect(compare("1-alpha1", "1-alpha2")).toBe(-1);
    expect(compare("1-rc", "1-rc2")).toBe(-1);
    expect(compare("1-cr2", "1-rc2")).toBe(0); // cr == rc
    expect(compare("1-1-snapshot", "1-1")).toBe(-1); // snapshot < release, nested
  });
});

describe("maven comparator — numeric and unknown-qualifier ordering", () => {
  const cases: ReadonlyArray<readonly [string, string, -1 | 0 | 1]> = [
    ["2.0", "2-1", -1], // 2.0 == 2, and 2 < 2-1 (list token)
    ["2-1", "2.0.a", -1], // list token < unknown qualifier
    ["2.0.2", "2.0.123", -1], // numeric magnitude, not lexical
    ["2.1.0", "2.2", -1], // 2.1.0 == 2.1 < 2.2
    ["11.a2", "11.a11", -1], // alpha-2 < alpha-11 (numeric, not lexical)
    ["11", "11.a", -1], // unknown qualifier "a" sorts after RELEASE
    ["11.a", "11b", -1], // ".a" (list) < "b" bare qualifier
    ["11b", "11c", -1], // unknown qualifiers compared lexically
    ["1.1", "1-sp", 1], // numeric token newer than a qualifier token
    ["1-2", "1-1", 1], // anti-symmetric of 1-1 < 1-2
  ];

  it.each(cases)("compare(%s, %s) === %i", (a, b, expected) => {
    expect(compare(a, b)).toBe(expected);
  });
});

describe("maven comparator — BigInt precision (beyond int/long range)", () => {
  it("compares numeric tokens exactly past 2^63", () => {
    expect(compare("1.10000000000000000001", "1.10000000000000000002")).toBe(
      -1,
    );
    expect(compare("1.10000000000000000002", "1.10000000000000000001")).toBe(1);
    expect(compare("1.99999999999999999999", "2.0")).toBe(-1);
  });
});

describe("maven comparator — algebraic properties", () => {
  const versions = [
    "1.0-alpha",
    "1.0-SNAPSHOT",
    "1.0",
    "1.0-sp",
    "1.0.1",
    "1-rc",
    "2.0.a",
    "2-1",
    "11.a2",
  ];

  it("is reflexive: compare(x, x) === 0", () => {
    for (const v of versions) {
      expect(compare(v, v)).toBe(0);
    }
  });

  it("is anti-symmetric: compare(a, b) === -compare(b, a)", () => {
    for (const a of versions) {
      for (const b of versions) {
        // compare(a,b) === -compare(b,a) <=> the two are exact opposites.
        // Assert via the sum to sidestep JavaScript's -0 vs +0 distinction.
        expect(compare(a, b) + compare(b, a)).toBe(0);
      }
    }
  });
});
