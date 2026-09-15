import type {
  VulnerabilityOfflineBundleImport,
  VulnerabilityOfflineBundleManifest,
  VulnerabilityOfflineBundleSignatureReceipt,
  VulnerabilityProviderRecord,
  VulnerabilityCsafReconciliationDetail,
} from "@repo/contracts/vulnerabilities";

export const VULNERABILITY_OFFLINE_BUNDLE_REPOSITORY = Symbol(
  "VULNERABILITY_OFFLINE_BUNDLE_REPOSITORY",
);

/**
 * Deployment-global mirror imports deliberately have no organization input.
 * Only the verified authenticated administrator is recorded as the actor.
 */
export interface VulnerabilityOfflineBundleRepository {
  preflight(
    input: Readonly<{
      bundleId: string;
      bundleVersion: string;
      manifestSha256: string;
      signingKeyId: string;
      manifest: VulnerabilityOfflineBundleManifest;
      verificationReceipt: VulnerabilityOfflineBundleSignatureReceipt;
      actorId: string;
      idempotencyKey: string;
      correlationId: string;
      payloads: readonly Readonly<{
        feedKey: VulnerabilityOfflineBundleManifest["payloads"][number]["feedKey"];
        sourceSnapshotAt: string;
        payloadSha256: string;
        schemaVersion: string;
        expectedRecordCount: number;
      }>[];
      stagingWorkerId: string;
    }>,
  ): Promise<OfflineBundlePreparedImport>;
  confirm(
    input: Readonly<{
      importId: string;
      actorId: string;
      idempotencyKey: string;
    }>,
  ): Promise<VulnerabilityOfflineBundleImport>;
  get(importId: string): Promise<VulnerabilityOfflineBundleImport>;
  csafReconciliation(
    canonicalId: string,
  ): Promise<VulnerabilityCsafReconciliationDetail | null>;
  stage(
    input: Readonly<{
      runId: string;
      workerId: string;
      record: VulnerabilityProviderRecord;
    }>,
  ): Promise<void>;
  completeStaging(
    input: Readonly<{
      runId: string;
      workerId: string;
      expectedRecordCount: number;
    }>,
  ): Promise<void>;
}

export type OfflineBundlePreparedImport = Readonly<{
  import: VulnerabilityOfflineBundleImport;
  runs: readonly Readonly<{
    id: string;
    feedKey: VulnerabilityOfflineBundleManifest["payloads"][number]["feedKey"];
  }>[];
}>;
