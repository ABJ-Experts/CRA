import { describe, it, expect } from "vitest";
import { compare } from "./semver";

// Assert a<b in both directions and that compare is anti-symmetric on the pair.
function expectLess(a: string, b: string): void {
  expect(compare(a, b)).toBe(-1);
  expect(compare(b, a)).toBe(1);
  expect(compare(a, b)).toBe(-compare(b, a));
}

describe("semver comparator (SemVer 2.0.0)", () => {
  describe("§10.3 trap-table rows", () => {
    it("sorts a pre-release before its associated normal version", () => {
      // "1.0.0-alpha" < "1.0.0"
      expect(compare("1.0.0-alpha", "1.0.0")).toBe(-1);
      expect(compare("1.0.0", "1.0.0-alpha")).toBe(1);
    });

    it("compares numeric segments numerically, not lexically", () => {
      // "1.10.0" > "1.9.0" — string ordering would wrongly say 1.10.0 < 1.9.0.
      expect(compare("1.10.0", "1.9.0")).toBe(1);
      expect(compare("1.9.0", "1.10.0")).toBe(-1);
    });
  });

  describe("§11.2 core precedence (MAJOR.MINOR.PATCH numeric)", () => {
    it("orders 1.0.0 < 2.0.0 < 2.1.0 < 2.1.1", () => {
      // Spec example chain from §11.2.
      expectLess("1.0.0", "2.0.0");
      expectLess("2.0.0", "2.1.0");
      expectLess("2.1.0", "2.1.1");
    });

    it("orders patch and major bumps correctly", () => {
      expectLess("1.0.0", "1.0.1");
      expectLess("1.9.9", "2.0.0");
    });
  });

  describe("§11.3–§11.4 pre-release precedence chain", () => {
    // Full spec example (§11.4):
    // 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta
    //   < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];

    it("orders every adjacent pair ascending (and anti-symmetrically)", () => {
      for (let i = 0; i < ordered.length - 1; i += 1) {
        expectLess(ordered[i]!, ordered[i + 1]!);
      }
    });

    it("§11.4.4 larger set of fields has higher precedence", () => {
      expectLess("1.0.0-alpha", "1.0.0-alpha.1");
    });

    it("§11.4.1 numeric pre-release identifiers compared numerically", () => {
      // beta.11 > beta.2 numerically (lexical string order would flip this).
      expectLess("1.0.0-beta.2", "1.0.0-beta.11");
      expectLess("1.0.0-alpha.1", "1.0.0-alpha.2");
    });

    it("§11.4.3 numeric identifiers rank below alphanumeric", () => {
      expectLess("1.0.0-1", "1.0.0-alpha");
      expectLess("1.0.0-alpha.1", "1.0.0-alpha.beta");
    });
  });

  describe("§9 build metadata is ignored in precedence", () => {
    it("treats versions differing only in build metadata as equal", () => {
      expect(compare("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
      expect(compare("1.0.0", "1.0.0+20130313144700")).toBe(0);
    });

    it("ignores build metadata on a pre-release too", () => {
      expect(compare("1.0.0-alpha+001", "1.0.0-alpha+999")).toBe(0);
    });
  });

  describe("equality and normalisation", () => {
    it("treats identical versions as equal", () => {
      expect(compare("1.2.3", "1.2.3")).toBe(0);
      expect(compare("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
    });

    it("accepts an optional leading v", () => {
      expect(compare("v1.2.3", "1.2.3")).toBe(0);
      expect(compare("v2.0.0", "v1.0.0")).toBe(1);
    });
  });

  describe("anti-symmetry spot checks", () => {
    const pairs: readonly [string, string][] = [
      ["1.0.0-alpha", "1.0.0"],
      ["1.10.0", "1.9.0"],
      ["2.1.1", "2.1.0"],
      ["1.0.0-beta.2", "1.0.0-beta.11"],
      ["1.0.0+a", "1.0.0+b"],
    ];

    it("satisfies compare(a,b) === -compare(b,a) for every pair", () => {
      for (const [a, b] of pairs) {
        // Use === (not Object.is) so the equal case (+0 vs -0) is treated equal.
        expect(compare(a, b) === -compare(b, a)).toBe(true);
      }
    });
  });
});
