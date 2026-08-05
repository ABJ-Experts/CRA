import { describe, it, expect } from "vitest";
import { compare } from "./deb";

describe("deb comparator (deb-version(7) / dpkg --compare-versions)", () => {
  // §10.3 trap-table rows for deb.
  it("epoch dominates the rest: 1:2.3 > 2.4", () => {
    expect(compare("1:2.3", "2.4")).toBe(1);
  });
  it("tilde sorts before everything: 1.0~rc1 < 1.0", () => {
    expect(compare("1.0~rc1", "1.0")).toBe(-1);
  });
  it("equality: 1.0 == 1.0", () => {
    expect(compare("1.0", "1.0")).toBe(0);
  });
  it("numeric upstream: 2.0 > 1.0", () => {
    expect(compare("2.0", "1.0")).toBe(1);
  });
  it("revision compared numerically: 1.0-1 < 1.0-2", () => {
    expect(compare("1.0-1", "1.0-2")).toBe(-1);
  });

  // Tilde ordering chain from dpkg's own test suite:
  // 1.0~~ < 1.0~~a < 1.0~ < 1.0.
  it("tilde chain: 1.0~~ < 1.0~~a", () => {
    expect(compare("1.0~~", "1.0~~a")).toBe(-1);
  });
  it("tilde chain: 1.0~~a < 1.0~", () => {
    expect(compare("1.0~~a", "1.0~")).toBe(-1);
  });
  it("tilde chain: 1.0~ < 1.0", () => {
    expect(compare("1.0~", "1.0")).toBe(-1);
  });

  // End-of-string sorts below an appended letter, but a tilde sorts below both.
  it("appended letter is larger than bare: 1.0a > 1.0", () => {
    expect(compare("1.0a", "1.0")).toBe(1);
  });
  it("appended tilde is smaller than bare: 1.0~a < 1.0", () => {
    expect(compare("1.0~a", "1.0")).toBe(-1);
  });
  it("numeric-vs-string: 1.0 < 1.0a", () => {
    expect(compare("1.0", "1.0a")).toBe(-1);
  });

  // order(): all letters sort BEFORE all non-letter punctuation.
  it("letters before punctuation: 1.0a < 1.0+", () => {
    expect(compare("1.0a", "1.0+")).toBe(-1);
  });

  // Digit runs compare numerically, not lexically.
  it("numeric not lexical: 1.10 > 1.9", () => {
    expect(compare("1.10", "1.9")).toBe(1);
  });

  // Leading zeros are ignored in digit runs.
  it("leading zeros ignored: 1.007 == 1.7", () => {
    expect(compare("1.007", "1.7")).toBe(0);
  });
  it("zero-padded value equal: 1.0 == 1.00", () => {
    expect(compare("1.0", "1.00")).toBe(0);
  });

  // Revision is the part after the last hyphen, compared numerically.
  it("revision numeric: 1.0-1 < 1.0-10", () => {
    expect(compare("1.0-1", "1.0-10")).toBe(-1);
  });
  // An absent revision compares equal to "0".
  it("absent revision equals 0: 1.0 == 1.0-0", () => {
    expect(compare("1.0", "1.0-0")).toBe(0);
  });

  // Epoch rules.
  it("explicit epoch 0 equals absent: 0:1.0 == 1.0", () => {
    expect(compare("0:1.0", "1.0")).toBe(0);
  });
  it("same epoch falls through to upstream: 1:1.0 < 1:2.0", () => {
    expect(compare("1:1.0", "1:2.0")).toBe(-1);
  });
  it("higher epoch dominates lower upstream: 2:1.0 > 1:9.9", () => {
    expect(compare("2:1.0", "1:9.9")).toBe(1);
  });

  // Anti-symmetry: compare(a, b) === -compare(b, a).
  it("is anti-symmetric on representative pairs", () => {
    const pairs: [string, string][] = [
      ["1:2.3", "2.4"],
      ["1.0~rc1", "1.0"],
      ["1.0-1", "1.0-2"],
      ["1.10", "1.9"],
      ["1.0a", "1.0+"],
      ["2:1.0", "1:9.9"],
      ["1.0", "1.0"],
    ];
    for (const [a, b] of pairs) {
      const backward = compare(b, a);
      // Normalize -0 to 0 so toBe()'s Object.is check accepts the equal case.
      expect(compare(a, b)).toBe(backward === 0 ? 0 : -backward);
    }
  });
});
