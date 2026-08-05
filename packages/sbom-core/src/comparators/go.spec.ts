import { describe, it, expect } from "vitest";
import { compare } from "./go";

describe("go comparator (golang.org/x/mod/semver, BRD §10)", () => {
  describe("§10.3 trap table: build metadata is ignored", () => {
    it("ignores Go's +incompatible build suffix in ordering", () => {
      // TRAP: "+incompatible" must parse and NOT affect precedence.
      expect(compare("v1.2.3+incompatible", "v1.2.3")).toBe(0);
    });

    it("ignores +incompatible while still ordering by version", () => {
      expect(compare("v2.0.0+incompatible", "v1.9.0")).toBe(1);
    });

    it("ignores arbitrary +build metadata entirely", () => {
      expect(compare("v1.0.0+meta", "v1.0.0")).toBe(0);
      expect(compare("v1.0.0+build.1", "v1.0.0+build.2")).toBe(0);
    });
  });

  describe("core precedence (major.minor.patch as integers)", () => {
    it("orders by patch", () => {
      expect(compare("v1.2.3", "v1.2.0")).toBe(1);
      expect(compare("v1.2.0", "v1.2.3")).toBe(-1);
    });

    it("orders minor numerically, not lexically (10 > 9)", () => {
      expect(compare("v1.10.0", "v1.9.0")).toBe(1);
    });

    it("orders major numerically (10 > 2, 100 > 99)", () => {
      expect(compare("v10.0.0", "v2.0.0")).toBe(1);
      expect(compare("v1.0.100", "v1.0.99")).toBe(1);
    });

    it("treats identical releases as equal", () => {
      expect(compare("v1.2.3", "v1.2.3")).toBe(0);
    });
  });

  describe("pre-release precedence (SemVer §11)", () => {
    it("a pre-release is lower than its release", () => {
      expect(compare("v1.0.0-rc1", "v1.0.0")).toBe(-1);
      expect(compare("v1.0.0", "v1.0.0-rc1")).toBe(1);
    });

    it("orders the canonical SemVer §11 pre-release chain", () => {
      // alpha < alpha.1 < alpha.beta < beta < beta.2 < beta.11 < rc.1 < release
      expect(compare("v1.0.0-alpha", "v1.0.0-alpha.1")).toBe(-1);
      expect(compare("v1.0.0-alpha.1", "v1.0.0-alpha.beta")).toBe(-1);
      expect(compare("v1.0.0-alpha.beta", "v1.0.0-beta")).toBe(-1);
      expect(compare("v1.0.0-beta", "v1.0.0-beta.2")).toBe(-1);
      expect(compare("v1.0.0-beta.2", "v1.0.0-beta.11")).toBe(-1);
      expect(compare("v1.0.0-beta.11", "v1.0.0-rc.1")).toBe(-1);
      expect(compare("v1.0.0-rc.1", "v1.0.0")).toBe(-1);
    });

    it("ranks numeric identifiers below alphanumeric ones", () => {
      expect(compare("v1.0.0-1", "v1.0.0-alpha")).toBe(-1);
    });

    it("compares numeric pre-release fields by magnitude (2 < 11)", () => {
      expect(compare("v1.0.0-beta.2", "v1.0.0-beta.11")).toBe(-1);
    });

    it("treats identical pre-releases as equal", () => {
      expect(compare("v1.0.0-alpha.1", "v1.0.0-alpha.1")).toBe(0);
    });
  });

  describe("shorthand versions (missing minor/patch default to 0)", () => {
    it("treats v1 == v1.0.0 and v1.2 == v1.2.0", () => {
      expect(compare("v1", "v1.0.0")).toBe(0);
      expect(compare("v1.2", "v1.2.0")).toBe(0);
    });

    it("still orders shorthand against fuller versions", () => {
      expect(compare("v1", "v1.0.1")).toBe(-1);
    });
  });

  describe("lenient + invalid handling", () => {
    it("accepts a missing leading v leniently (1.2.3 == v1.2.3)", () => {
      expect(compare("1.2.3", "v1.2.3")).toBe(0);
    });

    it("sorts an unparseable version below a valid one", () => {
      expect(compare("garbage", "v1.0.0")).toBe(-1);
      expect(compare("v1.0.0", "garbage")).toBe(1);
    });

    it("treats two unparseable versions as equal", () => {
      expect(compare("garbage", "nonsense")).toBe(0);
    });
  });

  describe("anti-symmetry: compare(a, b) === -compare(b, a)", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["v1.2.3+incompatible", "v1.2.3"],
      ["v2.0.0+incompatible", "v1.9.0"],
      ["v1.10.0", "v1.9.0"],
      ["v1.0.0-rc1", "v1.0.0"],
      ["v1.0.0-alpha", "v1.0.0-alpha.1"],
      ["v1.0.0-1", "v1.0.0-alpha"],
      ["v1", "v1.0.1"],
      ["garbage", "v1.0.0"],
    ];

    for (const [a, b] of pairs) {
      it(`is anti-symmetric for (${a}, ${b})`, () => {
        // `|| 0` normalises JS negative zero (-1 * 0) so toBe's Object.is
        // check doesn't distinguish -0 from +0 on the equal pair.
        expect(compare(a, b)).toBe(-compare(b, a) || 0);
      });
    }
  });
});
