import { z } from "zod";

export const upgradeDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const upgradeTimestampSchema = z.iso.datetime({ offset: true });
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = integer.min(1);
const alias = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const semver = z
  .string()
  .max(128)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const upgradeActionSchema = z.enum([
  "upgrades.view",
  "upgrades.stage",
  "upgrades.apply",
  "upgrades.rollback",
]);
export const upgradeRunStateSchema = z.enum([
  "verifying",
  "preflight",
  "awaiting-initiation",
  "draining",
  "backup-verification",
  "migrating",
  "activating",
  "checking",
  "success",
  "failed",
  "rollback-required",
  "rolling-back",
  "rolled-back",
]);
export const upgradeJwsHeaderSchema = z.strictObject({
  alg: z.literal("EdDSA"),
  typ: z.literal("CRA-RELEASE+JWS"),
  kid: alias,
});
const archiveName = z
  .string()
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*\.(?:tar|tar\.gz)$/);
export const upgradeManifestSchema = z
  .strictObject({
    manifestVersion: z.literal(1),
    purpose: z.literal("cra-offline-application-release"),
    issuer: alias,
    releaseId: z.uuid(),
    version: semver,
    sequence: positive,
    issuedAt: upgradeTimestampSchema,
    expiresAt: upgradeTimestampSchema,
    platform: z.strictObject({
      os: z.literal("linux"),
      architecture: z.enum(["amd64", "arm64"]),
    }),
    compatibility: z.strictObject({
      sourceVersions: z.array(semver).min(1).max(16).refine(unique),
      sourceManifestDigests: z
        .array(upgradeDigestSchema)
        .min(1)
        .max(16)
        .refine(unique),
      sourceSchemaDigests: z
        .array(upgradeDigestSchema)
        .min(1)
        .max(16)
        .refine(unique),
      targetSchemaDigest: upgradeDigestSchema,
      supervisorVersions: z.array(semver).min(1).max(16).refine(unique),
    }),
    infrastructure: z.strictObject({
      postgres: upgradeDigestSchema,
      auth: upgradeDigestSchema,
      rest: upgradeDigestSchema,
      storage: upgradeDigestSchema,
      supervisor: upgradeDigestSchema,
    }),
    archive: z.strictObject({
      name: z.literal("payload.tar"),
      sha256: upgradeDigestSchema,
      bytes: positive,
      expandedBytes: positive,
      entryCount: positive.max(10000),
    }),
    images: z
      .array(
        z.strictObject({
          service: z.enum(["api", "web"]),
          digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          archive: z.strictObject({
            name: archiveName,
            sha256: upgradeDigestSchema,
            bytes: positive,
          }),
        }),
      )
      .min(1)
      .max(32)
      .refine(
        (images) =>
          unique(images.map((image) => image.service)) &&
          unique(images.map((image) => image.archive.name)),
        "Duplicate image inventory",
      ),
    migrations: z
      .array(
        z.strictObject({
          name: z
            .string()
            .max(180)
            .regex(/^[0-9]{14}_[a-z0-9_]+\.sql$/),
          sha256: upgradeDigestSchema,
          transactional: z.literal(true),
          backwardCompatible: z.literal(true),
        }),
      )
      .max(256)
      .refine(
        (items) => unique(items.map((item) => item.name)),
        "Duplicate migrations",
      ),
    artifacts: z
      .array(
        z.strictObject({
          name: z
            .string()
            .max(160)
            .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*\.(?:json|txt)$/),
          sha256: upgradeDigestSchema,
          bytes: positive,
          kind: z.enum(["sbom", "release-notes", "feed", "model"]),
        }),
      )
      .min(1)
      .max(128)
      .refine(
        (items) => items.filter((item) => item.kind === "sbom").length === 1,
        "Exactly one signed SBOM is required",
      ),
    requirements: z.strictObject({
      diskBytes: positive,
      memoryBytes: positive,
      backupRequired: z.literal(true),
      keyRequired: z.literal(true),
    }),
    expectedOutageSeconds: positive.max(86400),
    licenseEffects: z
      .array(
        z.enum(["unchanged", "revalidation-required", "features-may-change"]),
      )
      .min(1)
      .max(3)
      .refine(unique),
    rollback: z.strictObject({
      imageOnly: z.literal(true),
      backwardCompatible: z.literal(true),
    }),
  })
  .refine(
    (manifest) =>
      Date.parse(manifest.expiresAt) > Date.parse(manifest.issuedAt),
    "Release expiry must follow issue time",
  )
  .refine(
    (manifest) =>
      unique([
        ...manifest.images.map((image) => image.archive.name),
        ...manifest.migrations.map((migration) => migration.name),
        ...manifest.artifacts.map((artifact) => artifact.name),
      ]),
    "Release inventory names must be globally unique",
  )
  // Source arrays are zipped by index: acceptance must match one complete tuple.
  .refine(
    ({ compatibility: c }) =>
      c.sourceVersions.length === c.sourceManifestDigests.length &&
      c.sourceVersions.length === c.sourceSchemaDigests.length,
    "Source compatibility tuples must have equal lengths",
  );

export const upgradeEmptyQuerySchema = z.strictObject({});
export const upgradeInstanceParamsSchema = z.strictObject({
  instanceId: z.uuid(),
});
export const upgradeRunParamsSchema = upgradeInstanceParamsSchema.extend({
  runId: z.uuid(),
});
export const upgradeMutationSchema = z.strictObject({
  expectedVersion: integer,
  idempotencyKey: z.uuid(),
});
export const upgradeStageInputSchema = upgradeMutationSchema.extend({
  mediaId: z.uuid(),
});
export const upgradePreflightInputSchema = upgradeMutationSchema;
export const upgradeApplyInputSchema = upgradeMutationSchema.extend({
  fingerprint: upgradeDigestSchema,
  acknowledgedEffects: z.literal(true),
});
export const upgradeRollbackInputSchema = upgradeMutationSchema;
export const upgradeHistoryQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const upgradeFailureCodeSchema = z.enum([
  "unavailable",
  "forbidden",
  "conflict",
  "invalid-media",
  "untrusted-release",
  "incompatible-release",
  "preflight-failed",
  "drain-failed",
  "backup-failed",
  "migration-failed",
  "activation-failed",
  "health-failed",
  "reconciliation-required",
  "rollback-failed",
]);
export const upgradeMediaSchema = z.strictObject({
  id: z.uuid(),
  label: alias,
  discoveredAt: upgradeTimestampSchema,
  bytes: positive,
});
export const upgradeMediaListSchema = z.strictObject({
  items: z.array(upgradeMediaSchema).max(100),
});
export const upgradeCapabilitiesSchema = z.strictObject({
  instanceId: z.uuid(),
  enabled: z.boolean(),
  actions: z.array(upgradeActionSchema).max(4).refine(unique),
  platform: z.strictObject({
    os: z.literal("linux"),
    architecture: z.enum(["amd64", "arm64"]),
  }),
  currentVersion: semver.nullable(),
  supervisorVersion: semver,
  maintenance: z.boolean(),
  version: integer,
});
export const upgradePreflightCheckSchema = z.strictObject({
  code: z.enum([
    "signature",
    "inventory",
    "platform",
    "compatibility",
    "infrastructure",
    "supervisor",
    "schema",
    "migration-ledger",
    "backup",
    "key",
    "disk",
    "memory",
    "maintenance",
    "writers",
    "license",
    "rollback",
  ]),
  status: z.enum(["passed", "failed", "unknown"]),
  detail: z.enum([
    "verified",
    "unavailable",
    "mismatch",
    "insufficient",
    "blocked",
    "not-required",
  ]),
});
export const upgradeEffectsSummarySchema = z.strictObject({
  fromVersion: semver,
  toVersion: semver,
  manifestDigest: upgradeDigestSchema,
  expectedOutageSeconds: positive.max(86400),
  licenseEffects: z
    .array(
      z.enum(["unchanged", "revalidation-required", "features-may-change"]),
    )
    .min(1)
    .max(3)
    .refine(unique),
  rollback: z.literal("compatible-images-before-exposure"),
  dataRestored: z.literal(false),
  migrationsReversed: z.literal(false),
});
export const upgradePreflightSchema = z
  .strictObject({
    runId: z.uuid(),
    version: integer,
    fingerprint: upgradeDigestSchema,
    checkedAt: upgradeTimestampSchema,
    expiresAt: upgradeTimestampSchema,
    eligible: z.boolean(),
    summary: upgradeEffectsSummarySchema,
    checks: z.array(upgradePreflightCheckSchema).min(1).max(32),
  })
  .refine(
    (review) =>
      !review.eligible ||
      review.checks.every((check) => check.status === "passed"),
    "Eligible preflight requires passing checks",
  )
  .refine(
    (review) => Date.parse(review.expiresAt) > Date.parse(review.checkedAt),
    "Review expiry must follow check time",
  );
export const upgradeResultSchema = z.strictObject({
  instanceId: z.uuid(),
  fromVersion: semver.nullable(),
  toVersion: semver.nullable(),
  manifestDigest: upgradeDigestSchema.nullable(),
  startedAt: upgradeTimestampSchema,
  checkedAt: upgradeTimestampSchema.nullable(),
  checks: z.array(upgradePreflightCheckSchema).max(32),
  safeRemediation: z.array(upgradeFailureCodeSchema).max(16).refine(unique),
  imageDigests: z
    .array(z.string().regex(/^sha256:[a-f0-9]{64}$/))
    .max(64)
    .refine(unique),
  runId: z.uuid(),
  outcome: z.enum(["success", "failed", "rollback-required", "rolled-back"]),
  completedAt: upgradeTimestampSchema,
  failureCode: upgradeFailureCodeSchema.nullable(),
  maintenanceRetained: z.boolean(),
  exposurePossible: z.boolean(),
  dataRestored: z.literal(false),
  migrationsReversed: z.literal(false),
  evidenceId: z.uuid(),
});
export const upgradeRunSchema = z
  .strictObject({
    id: z.uuid(),
    instanceId: z.uuid(),
    mediaId: z.uuid(),
    version: integer,
    state: upgradeRunStateSchema,
    releaseId: z.uuid().nullable(),
    fromVersion: semver.nullable(),
    toVersion: semver.nullable(),
    manifestDigest: upgradeDigestSchema.nullable(),
    verified: z.boolean(),
    createdAt: upgradeTimestampSchema,
    updatedAt: upgradeTimestampSchema,
    completedAt: upgradeTimestampSchema.nullable(),
    failureCode: upgradeFailureCodeSchema.nullable(),
    preflight: upgradePreflightSchema.nullable(),
    result: upgradeResultSchema.nullable(),
  })
  .refine(
    (run) =>
      ["verifying", "failed"].includes(run.state) ||
      (run.verified &&
        run.manifestDigest !== null &&
        run.releaseId !== null &&
        run.toVersion !== null),
    "Advancing requires a verified release",
  );
export const upgradeHistorySchema = z.strictObject({
  items: z.array(upgradeRunSchema).max(100),
  nextCursor: z.uuid().nullable(),
});
export const upgradeDetailSchema = upgradeRunSchema;

export const upgradeControlActionSchema = z.enum([
  "capabilities/read",
  "media/list",
  "media/stage",
  "run/preflight",
  "run/list",
  "run/read",
  "run/apply",
  "run/reconcile",
  "run/rollback",
  "run/result",
]);
export const upgradeActorSchema = z.strictObject({
  principalId: z.uuid(),
  fingerprint256: z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/),
  grantRevision: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9_.:-]+$/),
});
export const upgradeControlRequestSchema = z.strictObject({
  requestId: z.uuid(),
  instanceId: z.uuid(),
  actor: upgradeActorSchema,
  action: upgradeControlActionSchema,
  input: z.record(z.string(), z.json()).optional(),
  issuedAt: upgradeTimestampSchema,
  mac: upgradeDigestSchema,
});
export const upgradeControlResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    requestId: z.uuid(),
    ok: z.literal(true),
    status: z.literal(200),
    value: z.json().optional(),
    mac: upgradeDigestSchema,
  }),
  z.strictObject({
    requestId: z.uuid(),
    ok: z.literal(false),
    status: z.union([
      z.literal(401),
      z.literal(403),
      z.literal(409),
      z.literal(503),
    ]),
    mac: upgradeDigestSchema,
  }),
]);
