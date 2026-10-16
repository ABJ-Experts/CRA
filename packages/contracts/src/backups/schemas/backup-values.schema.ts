import { z } from "zod";

export const backupTimestampSchema = z.iso.datetime({ offset: false });
export const backupDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const backupAliasSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const backupActionSchema = z.enum([
  "backups.view",
  "backups.configure",
  "backups.run",
  "backups.verify",
  "backups.cleanup",
]);
export const backupFailureCodeSchema = z.enum([
  "authorization_changed",
  "configuration_changed",
  "configuration_invalid",
  "source_unavailable",
  "source_identity_changed",
  "incompatible_runtime",
  "key_unavailable",
  "historical_key_unavailable",
  "repository_unavailable",
  "repository_full",
  "repository_discontinuity",
  "staging_unsafe",
  "insufficient_capacity",
  "wal_gap",
  "wal_receiver_failed",
  "base_backup_failed",
  "base_integrity_failed",
  "object_missing",
  "object_corrupt",
  "partial_publication",
  "fence_expired",
  "write_drain_timeout",
  "cancelled",
  "lease_lost",
  "interrupted",
  "ciphertext_invalid",
  "manifest_invalid",
  "archive_unsafe",
  "target_unsafe",
  "target_unavailable",
  "restore_failed",
  "schema_mismatch",
  "audit_discontinuity",
  "credentials_not_quarantined",
  "egress_not_blocked",
  "probe_failed",
  "audit_unavailable",
  "retention_authority_unavailable",
  "cleanup_failed",
  "internal_failure",
]);
export const backupStateSchema = z.enum([
  "queued",
  "running",
  "certified",
  "verified",
  "failed",
  "cancelled",
  "incomplete",
]);
export const backupStageSchema = z.enum([
  "queued",
  "validating",
  "preparing_base",
  "receiving_wal",
  "pausing_writes",
  "draining",
  "fencing",
  "copying_objects",
  "publishing",
  "certifying",
  "provisioning",
  "decrypting",
  "restoring",
  "replaying",
  "checking_integrity",
  "quarantining",
  "probing",
  "completed",
  "cancelled",
  "failed",
  "incomplete",
  "cleanup",
]);
export const backupPolicyConfigurationSchema = z.strictObject({
  sourceAlias: backupAliasSchema,
  repositoryAlias: backupAliasSchema,
  stagingAlias: backupAliasSchema,
  keyAlias: backupAliasSchema,
  targetProfile: backupAliasSchema,
  residency: backupAliasSchema,
  schedulingEnabled: z.boolean().default(false),
  checkpointIntervalMinutes: z.number().int().min(1).max(30).default(30),
  baseIntervalHours: z.number().int().min(1).max(24).default(24),
  verificationIntervalDays: z.number().int().min(1).max(30).default(30),
  retentionDays: z.number().int().min(30).max(36_500).default(30),
  pauseLimitSeconds: z.number().int().min(1).max(120).default(120),
});
export const backupCertificateSchema = z.strictObject({
  version: z.literal(1),
  checkpointId: z.uuid(),
  certifiedAt: backupTimestampSchema,
  recoveryPointAt: backupTimestampSchema,
  manifestSha256: backupDigestSchema,
  repositoryGeneration: z.uuid(),
  keyId: backupAliasSchema,
  baseRunId: z.uuid(),
  timeline: z.number().int().positive(),
  checkpointLsn: z.string().regex(/^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/),
  sourceSystemIdentifier: z.string().regex(/^\d{1,20}$/),
  databaseBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  objectBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  objectCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  walBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  postgresqlVersion: z.literal("17.6"),
  integrity: z.literal("passed"),
});
export const backupVerificationCheckCodeSchema = z.enum([
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
]);
export const backupVerificationCheckSchema = z.strictObject({
  code: backupVerificationCheckCodeSchema,
  status: z.enum(["passed", "failed", "unavailable"]),
  durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  failureCode: backupFailureCodeSchema.nullable(),
});
export const backupVerificationResultSchema = z
  .strictObject({
    targetProfile: backupAliasSchema,
    verifiedAt: backupTimestampSchema,
    integrity: z.enum(["passed", "failed", "incomplete"]),
    checks: z
      .array(backupVerificationCheckSchema)
      .min(1)
      .max(30)
      .refine(
        (checks) =>
          new Set(checks.map((check) => check.code)).size === checks.length,
        "Verification check codes must be unique",
      ),
    recoveryPointAgeMs: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    recoveryDurationMs: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    measuredProfile: backupAliasSchema,
    databaseBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    objectBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .refine(
    (value) =>
      value.integrity !== "passed" ||
      (value.checks.length ===
        backupVerificationCheckCodeSchema.options.length &&
        value.checks.every(
          (check) => check.status === "passed" && check.failureCode === null,
        )),
    "Passing verification requires all recorded checks to pass",
  );
