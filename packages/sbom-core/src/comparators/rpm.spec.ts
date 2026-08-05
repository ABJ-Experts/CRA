import { describe, it, expect } from "vitest";
import { compare } from "./rpm";

// Each row is [a, b, expected sign of compare(a, b)].
type Row = [string, string, -1 | 0 | 1];

function check(rows: Row[]): void {
  for (const [a, b, expected] of rows) {
    expect(compare(a, b), `compare(${a}, ${b})`).toBe(expected);
    // Anti-symmetry: compare(a, b) === -compare(b, a) for every pair.
    expect(
      compare(a, b) === -compare(b, a),
      `anti-symmetry for (${a}, ${b})`,
    ).toBe(true);
  }
}

describe("rpm comparator", () => {
  it("§10.3 trap: release is compared as its own field, after version", () => {
    // "1.0-1.el8" < "1.0-2.el8" — identical version, release 1 < 2.
    check([["1.0-1.el8", "1.0-2.el8", -1]]);
  });

  it("equalities", () => {
    check([
      ["1.0", "1.0", 0],
      ["2.0.1", "2.0.1", 0],
      ["5.5p1", "5.5p1", 0],
      ["xyz10", "xyz10", 0],
      ["1.0~rc1", "1.0~rc1", 0],
      ["1.0^git1", "1.0^git1", 0],
      // Leading zeros are dropped in numeric segments: 00 == 0.
      ["00", "0", 0],
      ["1.0-1.el8", "1.0-1.el8", 0],
    ]);
  });

  it("numeric ordering (dotted and padded)", () => {
    check([
      ["1.0.1", "1.0", 1],
      ["1.0", "1.0.1", -1],
      ["2.0", "1.9", 1],
      ["2.0.1", "2.0", 1],
      ["2.0", "2.0.1", -1],
      ["1.0.0", "1.0", 1],
      // p1 < p10 because the trailing digits compare numerically, not by strcmp.
      ["5.5p1", "5.5p10", -1],
      ["5.5p2", "5.6p1", -1],
    ]);
  });

  it("numeric segments always outrank alphabetic segments", () => {
    check([
      ["xyz.4", "8", -1],
      ["2.0.1a", "2.0.1", 1],
      ["2.0.1", "2.0.1a", -1],
      ["10xyz", "10.1xyz", -1],
      // An extra trailing segment makes a version greater (unlike "~").
      ["6.0.rc1", "6.0", 1],
      // Pure alphabetic segments fall back to strcmp.
      ["alpha", "beta", -1],
    ]);
  });

  it("tilde sorts before everything, even the empty string", () => {
    check([
      ["1.0~beta", "1.0", -1],
      ["1.0~rc1", "1.0", -1],
      ["1.0~rc1", "1.0~rc2", -1],
      ["1.0~rc1~git123", "1.0~rc1", -1],
      ["1.0~1", "1.0", -1],
    ]);
  });

  it("caret sorts after when one side ends (post-release snapshot)", () => {
    check([
      ["1.0", "1.0^git1", -1],
      ["1.0^git1", "1.0", 1],
      ["1.0^git2", "1.0^git1", 1],
      ["1.0", "1.0^", -1],
    ]);
  });

  it("epoch dominates and is compared numerically (absent == 0)", () => {
    check([
      // Epoch 1 beats a higher version at epoch 0.
      ["1:1.0", "2.0", 1],
      ["2.0", "1:1.0", -1],
      // Leading zeros in the epoch are irrelevant.
      ["01:1.0", "1:1.0", 0],
      // ":1.0" means epoch 0, same as no epoch at all.
      [":1.0", "1.0", 0],
    ]);
  });

  it("release compared only when both sides carry one (rpmVersionCompare)", () => {
    check([
      // No release on one side => release comparison is skipped => equal.
      ["1.0", "1.0-1", 0],
      ["1.0-1", "1.0", 0],
      // Both have a release => compared with rpmvercmp.
      ["1.0-1.el8", "1.0-1.el9", -1],
      ["1.0-2", "1.0-10", -1],
    ]);
  });
});
