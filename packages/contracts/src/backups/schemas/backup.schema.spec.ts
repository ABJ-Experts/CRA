import { describe, expect, it } from "vitest";
import {
  backupPolicyInputSchema,
  backupPolicySchema,
  backupMutationSchema,
  backupHistoryQuerySchema,
  backupAssuranceSchema,
  backupRunSchema,
  backupVerificationRequestSchema,
  backupValidationSchema,
  backupCleanupReviewSchema,
  backupCleanupInputSchema,
  backupRunRequestSchema,
  backupInstanceParamsSchema,
  backupRunParamsSchema,
  backupHistorySchema,
  backupCustomerHistorySchema,
  backupCertificateSchema,
} from "./index.js";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-14T10:00:00.000Z";
const digest = "a".repeat(64);
const configuration = {
  sourceAlias: "local-source",
  repositoryAlias: "off-host",
  stagingAlias: "private-ram",
  keyAlias: "backup-key-v1",
  targetProfile: "isolated-saas",
  residency: "eu",
};
const run = {
  id,
  instanceId: id,
  kind: "capture",
  parentRunId: null,
  state: "queued",
  stage: "queued",
  progress: 0,
  version: 1,
  attempt: 0,
  configurationRevision: 1,
  createdAt: at,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  failureCode: null,
  certificate: null,
  verification: null,
  cleanup: { state: "retained", deletedAt: null },
};
const assurance = {
  status: "unavailable",
  lastAttempt: null,
  lastCapture: null,
  lastVerification: null,
  lastVerifiedRestoreAt: null,
  recoverablePointAt: null,
  verificationDueAt: null,
  residency: null,
  sourceAt: null,
  observedAt: at,
  reasons: ["not_configured"],
};

describe("encrypted backup contracts", () => {
  it("preserves the last verified restore when a later drill fails", () => {
    const result = {
      ...assurance,
      status: "failed",
      lastVerifiedRestoreAt: at,
      lastVerification: {
        ...customerVerification,
        state: "failed",
        integrity: "failed",
      },
      reasons: ["verification_failed"],
    };
    expect(backupAssuranceSchema.parse(result).lastVerifiedRestoreAt).toBe(at);
    expect(
      backupAssuranceSchema.safeParse({
        ...result,
        lastVerifiedRestoreAt: "2026-10-15T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
  it("defaults safe policy intervals and keeps scheduling off", () => {
    const input = backupPolicyInputSchema.parse({
      expectedVersion: 0,
      idempotencyKey: id,
      configuration,
    });
    expect(input.configuration).toMatchObject({
      schedulingEnabled: false,
      checkpointIntervalMinutes: 30,
      baseIntervalHours: 24,
      verificationIntervalDays: 30,
      retentionDays: 30,
      pauseLimitSeconds: 120,
    });
    expect(
      backupPolicySchema.parse({
        instanceId: id,
        version: 1,
        configurationRevision: 1,
        configuration: input.configuration,
        approvedAt: at,
        approvedBy: "operator",
        lastValidatedAt: null,
      }).version,
    ).toBe(1);
  });
  it.each(["../tmp", "/tmp", "a/b", "postgres://secret", "A", "a%2fb"])(
    "rejects unsafe mount alias %s",
    (sourceAlias) => {
      expect(
        backupPolicyInputSchema.safeParse({
          expectedVersion: 0,
          idempotencyKey: id,
          configuration: { ...configuration, sourceAlias },
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    { pauseLimitSeconds: 121 },
    { retentionDays: 29 },
    { checkpointIntervalMinutes: 31 },
    { verificationIntervalDays: 31 },
    { key: "secret" },
    { residency: "eu\nsecret" },
  ])("rejects unsafe policy %j", (change) => {
    expect(
      backupPolicyInputSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: id,
        configuration: { ...configuration, ...change },
      }).success,
    ).toBe(false);
  });
  it("requires durable mutation identity, version and closed fields", () => {
    expect(
      backupMutationSchema.parse({ expectedVersion: 1, idempotencyKey: id })
        .expectedVersion,
    ).toBe(1);
    for (const invalid of [
      { expectedVersion: 0, idempotencyKey: id },
      { expectedVersion: 1 },
      { expectedVersion: 1, idempotencyKey: id, command: "rm" },
    ]) {
      expect(backupMutationSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      backupRunRequestSchema.parse({ expectedVersion: 1, idempotencyKey: id })
        .idempotencyKey,
    ).toBe(id);
    expect(
      backupVerificationRequestSchema.parse({
        expectedVersion: 1,
        idempotencyKey: id,
        targetProfile: "isolated-saas",
      }).targetProfile,
    ).toBe("isolated-saas");
  });
  it("bounds history and parses only decimal query integers", () => {
    expect(backupHistoryQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(
      backupHistoryQuerySchema.parse({
        limit: "100",
        cursor: id,
        kind: "capture",
      }).limit,
    ).toBe(100);
    for (const limit of [true, "", "1e2", "1.2", "-1", 101, 0]) {
      expect(backupHistoryQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(
      backupInstanceParamsSchema.parse({ instanceId: id }).instanceId,
    ).toBe(id);
    expect(
      backupRunParamsSchema.parse({ instanceId: id, runId: id }).runId,
    ).toBe(id);
  });
  it("requires completed, immutable authority before certified states", () => {
    expect(backupRunSchema.parse(run).state).toBe("queued");
    expect(
      backupRunSchema.safeParse({ ...run, state: "certified" }).success,
    ).toBe(false);
    expect(
      backupRunSchema.safeParse({
        ...run,
        state: "verified",
        kind: "verification",
        parentRunId: id,
      }).success,
    ).toBe(false);
    expect(
      backupRunSchema.safeParse({ ...run, kind: "verification" }).success,
    ).toBe(false);
    expect(
      backupHistorySchema.parse({ items: [run], nextCursor: null }).items,
    ).toHaveLength(1);
  });
  it("rejects healthy claims without independently verified capture and restore", () => {
    expect(backupAssuranceSchema.parse(assurance).status).toBe("unavailable");
    expect(
      backupAssuranceSchema.safeParse({
        ...assurance,
        status: "verified",
        reasons: [],
      }).success,
    ).toBe(false);
    expect(
      backupAssuranceSchema.safeParse({
        ...assurance,
        repositoryPath: "/private",
      }).success,
    ).toBe(false);
    expect(
      backupCustomerHistorySchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
  });
  it("uses bounded safe codes for validation and reviewed deletion", () => {
    expect(
      backupValidationSchema.parse({
        valid: false,
        checkedAt: at,
        configurationDigest: digest,
        checks: [{ code: "key_unavailable", status: "failed" }],
      }).valid,
    ).toBe(false);
    expect(
      backupCleanupReviewSchema.parse({
        runId: id,
        version: 1,
        eligible: false,
        blockers: ["last_recoverable_chain"],
        reviewFingerprint: digest,
        reviewedAt: at,
      }).eligible,
    ).toBe(false);
    expect(
      backupCleanupInputSchema.parse({
        expectedVersion: 1,
        idempotencyKey: id,
        reviewFingerprint: digest,
      }).reviewFingerprint,
    ).toBe(digest);
  });
  it("accepts a complete checkpoint certificate without exposing object inventories", () => {
    const certificate = {
      version: 1,
      checkpointId: id,
      certifiedAt: at,
      recoveryPointAt: at,
      manifestSha256: digest,
      repositoryGeneration: id,
      keyId: "backup-key-v1",
      baseRunId: id,
      timeline: 1,
      checkpointLsn: "0/ABCDEF",
      sourceSystemIdentifier: "123456789",
      databaseBytes: 1024,
      objectBytes: 1024,
      objectCount: 1,
      walBytes: 1024,
      postgresqlVersion: "17.6",
      integrity: "passed",
    };
    expect(backupCertificateSchema.parse(certificate).checkpointLsn).toBe(
      "0/ABCDEF",
    );
    expect(
      backupRunSchema.parse({
        ...run,
        state: "certified",
        progress: 100,
        completedAt: at,
        durationMs: 100,
        certificate,
      }).state,
    ).toBe("certified");
    expect(
      backupCertificateSchema.safeParse({
        ...certificate,
        checkpointLsn: "bad",
      }).success,
    ).toBe(false);
  });
});

const checkCodes = [
  "ciphertext_authentication",
  "manifest_integrity",
  "schema_migrations",
  "extensions",
  "ownership_acl_rls",
  "sequences",
  "object_integrity",
  "audit_continuity",
  "external_keys",
  "credential_quarantine",
  "session_revocation",
  "dataset_markers",
  "authentication",
  "tenant_isolation",
  "product_isolation",
  "private_evidence_access",
  "egress_denied",
  "runtime_compatibility",
] as const;
const verification = {
  targetProfile: "isolated-saas",
  verifiedAt: at,
  integrity: "passed",
  checks: checkCodes.map((code) => ({
    code,
    status: "passed",
    durationMs: 1,
    failureCode: null,
  })),
  recoveryPointAgeMs: 1000,
  recoveryDurationMs: 2000,
  measuredProfile: "isolated-saas",
  databaseBytes: 1024,
  objectBytes: 1024,
};
const customerCapture = {
  id,
  kind: "capture",
  state: "certified",
  createdAt: at,
  completedAt: at,
  durationMs: 100,
  integrity: "passed",
  failureCode: null,
};
const customerVerification = {
  ...customerCapture,
  kind: "verification",
  state: "verified",
};

describe("backup evidence cannot overstate authority", () => {
  it("requires every mandatory isolated restoration check for a passing result", async () => {
    const { backupVerificationResultSchema } = await import("./index.js");
    expect(backupVerificationResultSchema.parse(verification).integrity).toBe(
      "passed",
    );
    for (const checks of [
      verification.checks.slice(1),
      [...verification.checks, verification.checks[0]],
      verification.checks.map((check, index) =>
        index === 0
          ? { ...check, status: "failed", failureCode: "probe_failed" }
          : check,
      ),
    ]) {
      expect(
        backupVerificationResultSchema.safeParse({ ...verification, checks })
          .success,
      ).toBe(false);
    }
    expect(
      backupVerificationResultSchema.parse({
        ...verification,
        integrity: "incomplete",
        checks: [
          {
            code: "egress_denied",
            status: "unavailable",
            durationMs: 1,
            failureCode: "target_unavailable",
          },
        ],
      }).integrity,
    ).toBe("incomplete");
  });
  it("accepts only complete verification runs and independent non-overdue assurance", () => {
    expect(
      backupRunSchema.parse({
        ...run,
        kind: "verification",
        parentRunId: id,
        state: "verified",
        progress: 100,
        startedAt: at,
        completedAt: at,
        durationMs: 100,
        verification,
      }).state,
    ).toBe("verified");
    const valid = {
      ...assurance,
      status: "verified",
      lastCapture: customerCapture,
      lastVerification: customerVerification,
      lastVerifiedRestoreAt: at,
      recoverablePointAt: at,
      verificationDueAt: "2026-11-13T10:00:00.000Z",
      sourceAt: at,
      reasons: [],
    };
    expect(backupAssuranceSchema.parse(valid).status).toBe("verified");
    for (const change of [
      { lastCapture: null },
      { lastVerification: null },
      { lastVerifiedRestoreAt: null },
      { recoverablePointAt: null },
      { verificationDueAt: null },
      { sourceAt: null },
      { reasons: ["verification_failed"] },
      { lastCapture: { ...customerCapture, integrity: "failed" } },
      { lastVerification: { ...customerVerification, integrity: "unknown" } },
      { lastCapture: { ...customerCapture, state: "failed" } },
      { lastVerification: { ...customerVerification, state: "failed" } },
      { verificationDueAt: "2026-10-13T10:00:00.000Z" },
    ]) {
      expect(
        backupAssuranceSchema.safeParse({ ...valid, ...change }).success,
      ).toBe(false);
    }
  });
  it("cannot certify a failed validation or eligible cleanup with blockers", () => {
    expect(
      backupValidationSchema.safeParse({
        valid: true,
        checkedAt: at,
        configurationDigest: digest,
        checks: [{ code: "key_unavailable", status: "failed" }],
      }).success,
    ).toBe(false);
    expect(
      backupValidationSchema.safeParse({
        valid: true,
        checkedAt: at,
        configurationDigest: digest,
        checks: [],
      }).success,
    ).toBe(false);
    expect(
      backupCleanupReviewSchema.safeParse({
        runId: id,
        version: 1,
        eligible: true,
        blockers: ["legal_hold"],
        reviewFingerprint: digest,
        reviewedAt: at,
      }).success,
    ).toBe(false);
    expect(
      backupCleanupReviewSchema.parse({
        runId: id,
        version: 1,
        eligible: true,
        blockers: [],
        reviewFingerprint: digest,
        reviewedAt: at,
      }).eligible,
    ).toBe(true);
  });
});
describe("backup policy HTTP envelope", () => {
  it("keeps unconfigured policy serializable and refuses an ambiguous empty success", async () => {
    const { backupPolicyResponseSchema } = await import("./index.js");
    expect(backupPolicyResponseSchema.parse({ policy: null })).toEqual({
      policy: null,
    });
    expect(backupPolicyResponseSchema.safeParse(null).success).toBe(false);
    expect(backupPolicyResponseSchema.safeParse({}).success).toBe(false);
  });
});
