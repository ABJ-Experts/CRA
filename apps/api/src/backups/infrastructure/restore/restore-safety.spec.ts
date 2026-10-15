import {
  assertFreshTarget,
  assertRecoveryArchiveEntry,
  assertRecoveryProfile,
  assertVerificationCoverage,
  RECOVERY_REQUIRED_CHECKS,
} from "./restore-safety";

describe("isolated recovery safety", () => {
  const profile = {
    image: "supabase/postgres:17.6.1.156",
    postgresVersion: "17.6",
    networkInternal: true,
    maxExpandedBytes: 8 * 1024 ** 3,
    maxEntries: 1000000,
    deadlineMs: 4 * 60 * 60 * 1000,
  };
  it("accepts only pinned compatible and egress-denied target profiles", () => {
    expect(() => assertRecoveryProfile(profile)).not.toThrow();
    for (const change of [
      { image: "postgres:latest" },
      { postgresVersion: "17.5" },
      { networkInternal: false },
      { maxExpandedBytes: Infinity },
      { deadlineMs: 0 },
    ])
      expect(() => assertRecoveryProfile({ ...profile, ...change })).toThrow(
        "recovery_profile_unsafe",
      );
  });
  it("rejects reused identities and any source volume or endpoint", () => {
    expect(() =>
      assertFreshTarget({
        name: "cra-backup-restore-12345678",
        existingNames: [],
        sourceNames: ["supabase_db_cra"],
      }),
    ).not.toThrow();
    for (const value of [
      {
        name: "supabase_db_cra",
        existingNames: [],
        sourceNames: ["supabase_db_cra"],
      },
      {
        name: "cra-backup-restore-12345678",
        existingNames: ["cra-backup-restore-12345678"],
        sourceNames: [],
      },
      { name: "../../production", existingNames: [], sourceNames: [] },
    ])
      expect(() => assertFreshTarget(value)).toThrow("recovery_target_unsafe");
  });
  it("rejects traversal, absolute paths, links, duplicate entries and expansion", () => {
    const seen = new Set<string>(["base/PG_VERSION"]);
    expect(
      assertRecoveryArchiveEntry(
        { path: "base/PG_VERSION", type: "file", size: 3 },
        new Set(),
        3,
        100,
      ),
    ).toBe("base/PG_VERSION");
    for (const entry of [
      { path: "../secret", type: "file", size: 1 },
      { path: "/pgdata/file", type: "file", size: 1 },
      { path: "base/PG_VERSION", type: "file", size: 3 },
      { path: "base/link", type: "symlink", size: 0 },
      { path: "base/file", type: "file", size: 101 },
      { path: "base\\..\\secret", type: "file", size: 1 },
      { path: "base/file\u0000suffix", type: "file", size: 1 },
    ])
      expect(() => assertRecoveryArchiveEntry(entry, seen, 3, 100)).toThrow(
        "recovery_archive_unsafe",
      );
  });
  it("never equates a command exit with complete restore verification", () => {
    expect(() =>
      assertVerificationCoverage([{ code: "restoration", status: "passed" }]),
    ).toThrow("recovery_checks_incomplete");
    const codes = RECOVERY_REQUIRED_CHECKS;
    expect(() =>
      assertVerificationCoverage(
        codes.map((code) => ({ code, status: "passed" })),
      ),
    ).not.toThrow();
    expect(() =>
      assertVerificationCoverage(
        codes.map((code) => ({
          code,
          status: code === "object_integrity" ? "failed" : "passed",
        })),
      ),
    ).toThrow("recovery_checks_incomplete");
  });
});
