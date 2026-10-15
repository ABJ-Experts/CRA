import { z } from "zod";
import {
  backupAliasSchema,
  backupCertificateSchema,
  backupDigestSchema,
  backupFailureCodeSchema,
  backupPolicyConfigurationSchema,
  backupStageSchema,
  backupStateSchema,
  backupTimestampSchema,
  backupVerificationResultSchema,
} from "./backup-values.schema.js";
const duration = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const backupPolicySchema = z.strictObject({
  instanceId: z.uuid(),
  version,
  configurationRevision: version,
  configuration: backupPolicyConfigurationSchema,
  approvedAt: backupTimestampSchema,
  approvedBy: z.string().regex(/^[A-Za-z0-9_.:@-]{1,160}$/),
  lastValidatedAt: backupTimestampSchema.nullable(),
});
export const backupPolicyResponseSchema = z.strictObject({
  policy: backupPolicySchema.nullable(),
});
export const backupRunSchema = z
  .strictObject({
    id: z.uuid(),
    instanceId: z.uuid(),
    kind: z.enum(["capture", "verification"]),
    parentRunId: z.uuid().nullable(),
    state: backupStateSchema,
    stage: backupStageSchema,
    progress: z.number().int().min(0).max(100),
    version,
    attempt: z.number().int().min(0).max(100),
    configurationRevision: version,
    createdAt: backupTimestampSchema,
    startedAt: backupTimestampSchema.nullable(),
    completedAt: backupTimestampSchema.nullable(),
    durationMs: duration,
    failureCode: backupFailureCodeSchema.nullable(),
    certificate: backupCertificateSchema.nullable(),
    verification: backupVerificationResultSchema.nullable(),
    cleanup: z.strictObject({
      state: z.enum(["retained", "reviewed", "deleted"]),
      deletedAt: backupTimestampSchema.nullable(),
    }),
  })
  .refine(
    (run) => (run.kind === "verification") === (run.parentRunId !== null),
    "Verification requires a capture parent",
  )
  .refine(
    (run) =>
      run.state !== "certified" ||
      (run.kind === "capture" &&
        run.certificate !== null &&
        run.completedAt !== null &&
        run.progress === 100),
    "Certified captures require completed certificate authority",
  )
  .refine(
    (run) =>
      run.state !== "verified" ||
      (run.kind === "verification" &&
        run.verification?.integrity === "passed" &&
        run.completedAt !== null &&
        run.progress === 100),
    "Verified restoration requires complete passing results",
  );
export const backupHistorySchema = z.strictObject({
  items: z.array(backupRunSchema).max(100),
  nextCursor: z.uuid().nullable(),
});
export const backupCustomerRunSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["capture", "verification"]),
  state: backupStateSchema,
  createdAt: backupTimestampSchema,
  completedAt: backupTimestampSchema.nullable(),
  durationMs: duration,
  integrity: z.enum(["passed", "failed", "unknown"]),
  failureCode: backupFailureCodeSchema.nullable(),
});
export const backupCustomerHistorySchema = z.strictObject({
  items: z.array(backupCustomerRunSchema).max(100),
  nextCursor: z.uuid().nullable(),
});
export const backupAssuranceSchema = z
  .strictObject({
    status: z.enum([
      "running",
      "unverified",
      "verified",
      "failed",
      "incomplete",
      "overdue",
      "stale",
      "unavailable",
    ]),
    lastAttempt: backupCustomerRunSchema.nullable(),
    lastCapture: backupCustomerRunSchema.nullable(),
    lastVerification: backupCustomerRunSchema.nullable(),
    lastVerifiedRestoreAt: backupTimestampSchema.nullable(),
    recoverablePointAt: backupTimestampSchema.nullable(),
    verificationDueAt: backupTimestampSchema.nullable(),
    residency: backupAliasSchema.nullable(),
    sourceAt: backupTimestampSchema.nullable(),
    observedAt: backupTimestampSchema,
    reasons: z
      .array(
        z.enum([
          "not_configured",
          "authority_unavailable",
          "no_certified_capture",
          "no_verified_restore",
          "capture_running",
          "verification_running",
          "capture_failed",
          "verification_failed",
          "capture_incomplete",
          "verification_incomplete",
          "recovery_point_overdue",
          "verification_overdue",
          "source_stale",
          "clock_untrusted",
          "configuration_changed",
        ]),
      )
      .max(20),
  })
  .refine(
    (value) =>
      value.status !== "verified" ||
      (value.lastCapture?.state === "certified" &&
        value.lastCapture.integrity === "passed" &&
        value.lastVerification?.state === "verified" &&
        value.lastVerification.integrity === "passed" &&
        value.lastVerifiedRestoreAt !== null &&
        value.recoverablePointAt !== null &&
        value.verificationDueAt !== null &&
        Date.parse(value.verificationDueAt) >= Date.parse(value.observedAt) &&
        value.sourceAt !== null &&
        value.reasons.length === 0),
    "Verified assurance requires independently measured capture and restore authority",
  )
  .refine(
    (value) =>
      value.lastVerifiedRestoreAt === null ||
      Date.parse(value.lastVerifiedRestoreAt) <= Date.parse(value.observedAt),
    "A verified restoration timestamp cannot be in the future",
  );
export const backupValidationSchema = z
  .strictObject({
    valid: z.boolean(),
    checkedAt: backupTimestampSchema,
    configurationDigest: backupDigestSchema,
    checks: z
      .array(
        z.strictObject({
          code: z.enum([
            "runtime_compatibility",
            "source_identity",
            "repository_mount",
            "staging_mount",
            "key_mount",
            "key_recovery",
            "residency",
            "capacity",
            "target_profile",
            "encryption",
            "recovery_drill",
            ...backupFailureCodeSchema.options,
          ]),
          status: z.enum(["passed", "failed", "unavailable"]),
        }),
      )
      .max(50),
  })
  .refine(
    (value) =>
      !value.valid ||
      (value.checks.length > 0 &&
        value.checks.every((check) => check.status === "passed")),
    "Valid configuration requires successful checks",
  );
export const backupCleanupReviewSchema = z
  .strictObject({
    runId: z.uuid(),
    version,
    eligible: z.boolean(),
    reviewFingerprint: backupDigestSchema,
    reviewedAt: backupTimestampSchema,
    blockers: z
      .array(
        z.enum([
          "retention_active",
          "legal_hold",
          "authority_unknown",
          "last_recoverable_chain",
          "required_dependency",
          "insufficient_verified_chains",
          "run_active",
          "already_deleted",
          "verification_required",
        ]),
      )
      .max(20),
  })
  .refine(
    (value) => !value.eligible || value.blockers.length === 0,
    "Eligible cleanup cannot have blockers",
  );
