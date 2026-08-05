// BRD §10.3 trap table — every row is a mandatory test case, routed through the
// Abstract Factory. "Version comparison is where correctness quietly dies."
import { describe, it, expect } from "vitest";
import type { Ecosystem } from "../model";
import { comparatorFor } from "./index";

const TRAP_TABLE: Array<[Ecosystem, string, string, -1 | 0 | 1, string]> = [
  [
    "semver",
    "1.0.0-alpha",
    "1.0.0",
    -1,
    "pre-release sorts before the release",
  ],
  [
    "semver",
    "1.10.0",
    "1.9.0",
    1,
    "numeric segment comparison, not string ordering",
  ],
  ["deb", "1:2.3", "2.4", 1, "epoch wins regardless of the rest"],
  ["deb", "1.0~rc1", "1.0", -1, "tilde sorts before everything"],
  ["rpm", "1.0-1.el8", "1.0-2.el8", -1, "release segment compared separately"],
  ["maven", "1.0", "1.0.0", 0, "equal under Maven rules (unlike semver)"],
  ["pep440", "1.0.post1", "1.0", 1, "post-release is higher"],
  ["pep440", "1.0rc1", "1.0", -1, "rc is a pre-release, lower"],
  [
    "go",
    "v1.2.3+incompatible",
    "v1.2.3",
    0,
    "build metadata ignored in ordering",
  ],
];

describe("§10.3 trap table", () => {
  it.each(TRAP_TABLE)("%s: %s vs %s -> %d (%s)", (eco, a, b, expected) => {
    const compare = comparatorFor(eco);
    expect(compare(a, b)).toBe(expected);
    // Anti-symmetry: the reverse comparison must be the negation.
    expect(compare(b, a)).toBe(expected === 0 ? 0 : (-expected as -1 | 1));
  });
});
