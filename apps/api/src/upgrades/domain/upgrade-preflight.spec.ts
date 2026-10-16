import {
  preflightUpgrade,
  type UpgradePreflightFacts,
} from "./upgrade-preflight";
const runtime = {
  database: "a",
  auth: "b",
  rest: "c",
  storage: "d",
  gateway: "e",
};
const facts: UpgradePreflightFacts = {
  instanceId: "instance",
  manifestDigest: "manifest",
  stagedInventoryDigest: "staged",
  currentVersion: "1",
  currentManifestDigest: "old",
  currentSchemaDigest: "schema",
  sourceVersions: ["1"],
  sourceManifestDigests: ["old"],
  sourceSchemaDigests: ["schema"],
  targetSchemaDigest: "target",
  supervisorVersion: "1",
  supervisorVersions: ["1"],
  runtimeDigests: runtime,
  requiredRuntimeDigests: runtime,
  freeBytes: 10,
  requiredBytes: 5,
  memoryBytes: 10,
  requiredMemoryBytes: 5,
  platform: "linux/amd64",
  targetPlatform: "linux/amd64",
  ledgerDigest: "ledger",
  expectedLedgerDigest: "ledger",
  pendingMigrations: ["2"],
  signedMigrations: ["2"],
  migrationsTransactional: true,
  previousCompatibleAfterCandidateWrites: true,
  backupCertificateDigest: "backup",
  backupVerified: true,
  backupHeld: true,
  requiredKeysAvailable: true,
  licenceAllowsUpgrade: true,
  processInventoryComplete: true,
  unmanagedWriters: false,
  concurrentMaintenance: false,
  authorityDigest: "authority",
  trustDigest: "trust",
  checkedAt: "2026-10-15T00:00:00Z",
  expiresAt: "2026-10-15T00:05:00Z",
};
const now = new Date("2026-10-15T00:01:00Z");
describe("upgrade preflight", () => {
  it("fingerprints every review input canonically", () => {
    const result = preflightUpgrade(facts, now);
    expect(result.allowed).toBe(true);
    expect(
      preflightUpgrade(
        {
          ...facts,
          runtimeDigests: {
            gateway: "e",
            storage: "d",
            rest: "c",
            auth: "b",
            database: "a",
          },
        },
        now,
      ).fingerprint,
    ).toBe(result.fingerprint);
    expect(
      preflightUpgrade({ ...facts, authorityDigest: "changed" }, now)
        .fingerprint,
    ).not.toBe(result.fingerprint);
  });
  it.each<Partial<UpgradePreflightFacts>>([
    { freeBytes: 0 },
    { requiredBytes: NaN },
    { memoryBytes: 0 },
    { requiredMemoryBytes: 0 },
    { platform: "linux/arm64" },
    { currentVersion: "0" },
    { currentManifestDigest: "unknown" },
    { currentSchemaDigest: "unknown" },
    { supervisorVersion: "0" },
    { runtimeDigests: {} },
    { requiredRuntimeDigests: {} },
    { ledgerDigest: "drift" },
    { pendingMigrations: [] },
    { signedMigrations: ["2", "2"] },
    { migrationsTransactional: false },
    { previousCompatibleAfterCandidateWrites: false },
    { backupVerified: false },
    { backupHeld: false },
    { backupCertificateDigest: "" },
    { requiredKeysAvailable: false },
    { licenceAllowsUpgrade: false },
    { processInventoryComplete: false },
    { unmanagedWriters: true },
    { concurrentMaintenance: true },
    { expiresAt: "2025-01-01" },
    { checkedAt: "invalid" },
    { authorityDigest: "" },
    { trustDigest: "" },
    { stagedInventoryDigest: "" },
    { targetSchemaDigest: "" },
  ])("fails closed for %j", (patch) => {
    expect(preflightUpgrade({ ...facts, ...patch }, now).allowed).toBe(false);
  });
  it("requires one compatible source tuple, never mix and match historical versions", () => {
    expect(
      preflightUpgrade(
        {
          ...facts,
          sourceVersions: ["1", "2"],
          sourceManifestDigests: ["wrong", "old"],
          sourceSchemaDigests: ["schema", "other"],
        },
        now,
      ).allowed,
    ).toBe(false);
  });
});
