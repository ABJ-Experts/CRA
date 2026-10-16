import { createHash } from "node:crypto";

export interface UpgradePreflightFacts {
  readonly instanceId: string;
  readonly manifestDigest: string;
  readonly stagedInventoryDigest: string;
  readonly currentVersion: string;
  readonly currentManifestDigest: string;
  readonly currentSchemaDigest: string;
  readonly sourceVersions: readonly string[];
  readonly sourceManifestDigests: readonly string[];
  readonly sourceSchemaDigests: readonly string[];
  readonly targetSchemaDigest: string;
  readonly supervisorVersion: string;
  readonly supervisorVersions: readonly string[];
  readonly runtimeDigests: Readonly<Record<string, string>>;
  readonly requiredRuntimeDigests: Readonly<Record<string, string>>;
  readonly freeBytes: number;
  readonly requiredBytes: number;
  readonly memoryBytes: number;
  readonly requiredMemoryBytes: number;
  readonly platform: string;
  readonly targetPlatform: string;
  readonly ledgerDigest: string;
  readonly expectedLedgerDigest: string;
  readonly pendingMigrations: readonly string[];
  readonly signedMigrations: readonly string[];
  readonly migrationsTransactional: boolean;
  readonly previousCompatibleAfterCandidateWrites: boolean;
  readonly backupCertificateDigest: string;
  readonly backupVerified: boolean;
  readonly backupHeld: boolean;
  readonly requiredKeysAvailable: boolean;
  readonly licenceAllowsUpgrade: boolean;
  readonly processInventoryComplete: boolean;
  readonly unmanagedWriters: boolean;
  readonly concurrentMaintenance: boolean;
  readonly authorityDigest: string;
  readonly trustDigest: string;
  readonly checkedAt: string;
  readonly expiresAt: string;
}
export interface UpgradePreflightResult {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
  readonly fingerprint: string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function preflightUpgrade(
  f: UpgradePreflightFacts,
  now: Date,
): UpgradePreflightResult {
  const checks: readonly (readonly [string, boolean])[] = [
    [
      "resources",
      Number.isSafeInteger(f.freeBytes) &&
        Number.isSafeInteger(f.requiredBytes) &&
        f.requiredBytes > 0 &&
        f.freeBytes >= f.requiredBytes &&
        Number.isSafeInteger(f.memoryBytes) &&
        Number.isSafeInteger(f.requiredMemoryBytes) &&
        f.requiredMemoryBytes > 0 &&
        f.memoryBytes >= f.requiredMemoryBytes,
    ],
    ["platform", f.platform === f.targetPlatform],
    [
      "source-compatibility",
      f.sourceVersions.length === f.sourceManifestDigests.length &&
        f.sourceVersions.length === f.sourceSchemaDigests.length &&
        f.sourceVersions.some(
          (version, index) =>
            version === f.currentVersion &&
            f.sourceManifestDigests[index] === f.currentManifestDigest &&
            f.sourceSchemaDigests[index] === f.currentSchemaDigest,
        ),
    ],
    ["supervisor", f.supervisorVersions.includes(f.supervisorVersion)],
    [
      "fixed-runtime",
      Object.keys(f.requiredRuntimeDigests).length === 5 &&
        canonical(f.runtimeDigests) === canonical(f.requiredRuntimeDigests),
    ],
    ["migration-ledger", f.ledgerDigest === f.expectedLedgerDigest],
    [
      "migration-inventory",
      canonical(f.pendingMigrations) === canonical(f.signedMigrations) &&
        new Set(f.signedMigrations).size === f.signedMigrations.length,
    ],
    ["migration-atomicity", f.migrationsTransactional],
    ["previous-image-compatibility", f.previousCompatibleAfterCandidateWrites],
    [
      "backup",
      f.backupVerified && f.backupHeld && f.backupCertificateDigest.length > 0,
    ],
    ["keys", f.requiredKeysAvailable],
    ["licence", f.licenceAllowsUpgrade],
    ["process-inventory", f.processInventoryComplete && !f.unmanagedWriters],
    ["maintenance", !f.concurrentMaintenance],
    [
      "freshness",
      Number.isFinite(now.getTime()) &&
        Date.parse(f.checkedAt) <= now.getTime() &&
        now.getTime() < Date.parse(f.expiresAt),
    ],
    [
      "authority",
      f.authorityDigest.length > 0 &&
        f.trustDigest.length > 0 &&
        f.stagedInventoryDigest.length > 0 &&
        f.targetSchemaDigest.length > 0,
    ],
  ];
  const blockers = checks.filter(([, passed]) => !passed).map(([code]) => code);
  return {
    allowed: blockers.length === 0,
    blockers,
    fingerprint: createHash("sha256").update(canonical(f)).digest("hex"),
  };
}
