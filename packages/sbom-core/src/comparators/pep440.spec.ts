import { describe, it, expect } from "vitest";
import { compare } from "./pep440";

describe("pep440 compare", () => {
  describe("§10.3 trap-table rows", () => {
    it("post-release is higher than the plain release", () => {
      expect(compare("1.0.post1", "1.0")).toBe(1);
      expect(compare("1.0", "1.0.post1")).toBe(-1);
    });

    it("rc is a pre-release, lower than the plain release", () => {
      expect(compare("1.0rc1", "1.0")).toBe(-1);
      expect(compare("1.0", "1.0rc1")).toBe(1);
    });

    it("a bare .dev sorts before any pre-release", () => {
      expect(compare("1.0.dev1", "1.0rc1")).toBe(-1);
      expect(compare("1.0rc1", "1.0.dev1")).toBe(1);
    });

    it("epoch is compared first and dominates the release", () => {
      expect(compare("1!1.0", "2.0")).toBe(1);
      expect(compare("2.0", "1!1.0")).toBe(-1);
    });

    it("pre-release letters order a < b < rc < release", () => {
      expect(compare("1.0a1", "1.0b1")).toBe(-1);
      expect(compare("1.0b1", "1.0rc1")).toBe(-1);
      expect(compare("1.0rc1", "1.0")).toBe(-1);
    });
  });

  describe("normalisation / equality (compare === 0)", () => {
    it("pre-release separators are equivalent", () => {
      expect(compare("1.0rc1", "1.0.rc1")).toBe(0);
      expect(compare("1.0.rc1", "1.0-rc1")).toBe(0);
      expect(compare("1.0rc1", "1.0_rc1")).toBe(0);
    });

    it("is case-insensitive and spells out alpha/beta/c", () => {
      expect(compare("1.0RC1", "1.0rc1")).toBe(0);
      expect(compare("1.0alpha1", "1.0a1")).toBe(0);
      expect(compare("1.0beta2", "1.0b2")).toBe(0);
      expect(compare("1.0c1", "1.0rc1")).toBe(0);
    });

    it("implicit pre/post/dev numbers default to 0", () => {
      expect(compare("1.0a", "1.0a0")).toBe(0);
      expect(compare("1.0.post", "1.0.post0")).toBe(0);
      expect(compare("1.0.dev", "1.0.dev0")).toBe(0);
    });

    it("implicit post release: '-N' equals '.postN'; rev/r are post spellings", () => {
      expect(compare("1.0-1", "1.0.post1")).toBe(0);
      expect(compare("1.0.rev1", "1.0.post1")).toBe(0);
      expect(compare("1.0.r1", "1.0.post1")).toBe(0);
    });

    it("normalises a leading v, leading zeros, and trailing-zero release parts", () => {
      expect(compare("v1.0", "1.0")).toBe(0);
      expect(compare("01.0", "1.0")).toBe(0);
      expect(compare("1.0.0", "1.0")).toBe(0);
      expect(compare("1.0a05", "1.0a5")).toBe(0);
    });

    it("trims surrounding whitespace", () => {
      expect(compare("  1.0  ", "1.0")).toBe(0);
    });
  });

  describe("PEP 440 canonical sorted-example ordering", () => {
    // The exact ascending sequence from the PEP 440 specification.
    const ascending = [
      "1.0.dev456",
      "1.0a1",
      "1.0a2.dev456",
      "1.0a12.dev456",
      "1.0a12",
      "1.0b1.dev456",
      "1.0b2",
      "1.0b2.post345.dev456",
      "1.0b2.post345",
      "1.0rc1.dev456",
      "1.0rc1",
      "1.0",
      "1.0+abc.5",
      "1.0+abc.7",
      "1.0+5",
      "1.0.post456.dev34",
      "1.0.post456",
      "1.1.dev1",
    ];

    it("each adjacent pair is strictly increasing", () => {
      for (let i = 0; i + 1 < ascending.length; i++) {
        const lo = ascending[i]!;
        const hi = ascending[i + 1]!;
        expect(compare(lo, hi)).toBe(-1);
        expect(compare(hi, lo)).toBe(1);
      }
    });

    it("every element equals itself", () => {
      for (const v of ascending) {
        expect(compare(v, v)).toBe(0);
      }
    });
  });

  describe("epoch and local-version specifics", () => {
    it("any epoch outranks a higher release at a lower epoch", () => {
      expect(compare("1.0", "1!0.5")).toBe(-1);
      expect(compare("1!0.1", "0.99")).toBe(1);
    });

    it("a public version with a local segment sorts after the same public version", () => {
      expect(compare("1.0+local", "1.0")).toBe(1);
      expect(compare("1.0", "1.0+local")).toBe(-1);
    });

    it("within a local version, string segments sort before numeric segments", () => {
      expect(compare("1.0+abc", "1.0+1")).toBe(-1);
      expect(compare("1.0+1", "1.0+abc")).toBe(1);
    });

    it("shorter local prefix sorts before its longer extension", () => {
      expect(compare("1.0+abc", "1.0+abc.1")).toBe(-1);
    });
  });

  describe("anti-symmetry: compare(a, b) === -compare(b, a)", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["1.0.post1", "1.0"],
      ["1.0rc1", "1.0"],
      ["1.0.dev1", "1.0rc1"],
      ["1!1.0", "2.0"],
      ["1.0a1", "1.0b1"],
      ["1.0+abc.7", "1.0+5"],
      ["1.0", "1.0"],
    ];

    it("holds for representative pairs", () => {
      for (const [a, b] of pairs) {
        // `|| 0` normalises the -0 that negating a +0 would otherwise produce.
        const negated = (-compare(b, a) || 0) as -1 | 0 | 1;
        expect(compare(a, b)).toBe(negated);
      }
    });
  });
});
