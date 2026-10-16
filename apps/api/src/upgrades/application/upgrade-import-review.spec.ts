import {
  preflightUpgrade,
  type UpgradePreflightFacts,
} from "../domain/upgrade-preflight";
import { matchesApprovedImportReview } from "./upgrade-import-review";
const runtime = {
  postgres: "a",
  auth: "b",
  rest: "c",
  storage: "d",
  supervisor: "e",
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
  freeBytes: 1000,
  requiredBytes: 1000,
  memoryBytes: 100,
  requiredMemoryBytes: 100,
  platform: "linux/amd64",
  targetPlatform: "linux/amd64",
  ledgerDigest: "ledger",
  expectedLedgerDigest: "ledger",
  pendingMigrations: [],
  signedMigrations: [],
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
const fingerprint = preflightUpgrade(facts, now).fingerprint;
it("accepts only independently checked remaining resources after admitted import", () => {
  expect(
    matchesApprovedImportReview(
      facts,
      { ...facts, freeBytes: 400, requiredBytes: 400 },
      fingerprint,
      now,
    ),
  ).toBe(true);
  expect(
    matchesApprovedImportReview(
      facts,
      { ...facts, freeBytes: 399, requiredBytes: 400 },
      fingerprint,
      now,
    ),
  ).toBe(false);
});
it.each<Partial<UpgradePreflightFacts>>([
  { currentManifestDigest: "changed" },
  { currentSchemaDigest: "changed" },
  { authorityDigest: "changed" },
  { trustDigest: "changed" },
  { ledgerDigest: "changed" },
  { memoryBytes: 0 },
  { backupCertificateDigest: "changed" },
  { unmanagedWriters: true },
])(
  "rejects external source, authority or required-resource drift %j",
  (changed) => {
    expect(
      matchesApprovedImportReview(
        facts,
        { ...facts, freeBytes: 400, requiredBytes: 400, ...changed },
        fingerprint,
        now,
      ),
    ).toBe(false);
  },
);
it("does not renew expired approval or accept a different approval fingerprint", () => {
  expect(
    matchesApprovedImportReview(
      facts,
      { ...facts, freeBytes: 400, requiredBytes: 400 },
      "wrong",
      now,
    ),
  ).toBe(false);
  expect(
    matchesApprovedImportReview(
      facts,
      { ...facts, freeBytes: 400, requiredBytes: 400 },
      fingerprint,
      new Date("2026-10-15T00:10:00Z"),
    ),
  ).toBe(false);
});
