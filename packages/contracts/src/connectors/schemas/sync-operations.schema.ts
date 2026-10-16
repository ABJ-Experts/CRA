import { z } from "zod";
import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";
import { syncRunSchema } from "./sync-run.schema.js";
const timestamp = z.iso.datetime({ offset: true });
const version = z.number().int().nonnegative();
const field = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/)
  .refine(
    (value) =>
      !value
        .split(".")
        .some((segment) =>
          ["__proto__", "prototype", "constructor"].includes(segment),
        ),
  );
const entity = z.enum(["product", "release"]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const connectorFieldMappingSchema = z
  .object({
    entityType: entity,
    sourceField: field,
    targetField: field,
    transform: z.literal("identity"),
  })
  .strict();
export const connectorFieldMappingsSchema = z
  .array(connectorFieldMappingSchema)
  .max(32);
export const connectorFieldMapSchema = z
  .object({ revision: version, fields: connectorFieldMappingsSchema })
  .strict();
const discoveryField = z
  .object({
    field,
    type: z.enum(["string", "number", "boolean"]),
    nullable: z.boolean(),
    required: z.boolean(),
    sensitive: z.boolean(),
  })
  .strict();
export const connectorCapabilitiesSchema = z
  .object({
    adapterVersion: z.string().min(1).max(100),
    mappingVersion: z.string().min(1).max(100),
    entities: z
      .array(
        z
          .object({
            entityType: entity,
            fields: z
              .array(
                discoveryField.extend({
                  supportsPull: z.boolean(),
                  supportsPush: z.boolean(),
                  vendorFieldPath: field,
                }),
              )
              .max(100),
            supportsPush: z.boolean(),
            supportsTombstones: z.boolean(),
            supportsHierarchy: z.boolean(),
          })
          .strict(),
      )
      .max(2),
  })
  .strict();
export const connectorMappingDiscoverySchema = z
  .object({
    adapterVersion: z.string().min(1).max(100),
    mappingVersion: z.string().min(1).max(100),
    schemaDigest: digest,
    sources: z
      .array(
        z
          .object({
            entityType: entity,
            fields: z.array(discoveryField).max(100),
          })
          .strict(),
      )
      .max(2),
    targets: z
      .array(
        z
          .object({
            entityType: entity,
            fields: z.array(discoveryField).max(32),
          })
          .strict(),
      )
      .max(2),
  })
  .strict();
export const CONNECTOR_MAPPING_MESSAGES = Object.freeze({
  unknown_source: "The discovered source field is unavailable.",
  protected_target: "This target cannot be changed by a connector.",
  incompatible_type: "Source and target types are incompatible.",
  duplicate_target: "Each target can have only one source field.",
  sensitive_source: "Sensitive source fields cannot be mapped.",
  missing_required: "A required source value is missing.",
  invalid_value: "The source value does not satisfy the target contract.",
  snapshot_unavailable:
    "Retained source data is unavailable. Select explicit refetch.",
  cursor_changed:
    "The connector cursor changed. Review a fresh reconciliation.",
  mapping_changed: "The mapping changed. Generate a new preview.",
  authorization_changed: "Current access no longer permits this operation.",
});
export const connectorMappingIssueSchema = z
  .object({
    code: z.enum(
      Object.keys(CONNECTOR_MAPPING_MESSAGES) as [
        keyof typeof CONNECTOR_MAPPING_MESSAGES,
        ...(keyof typeof CONNECTOR_MAPPING_MESSAGES)[],
      ],
    ),
    entityType: entity.optional(),
    sourceField: field.optional(),
    targetField: field.optional(),
    recordId: z.string().min(1).max(500).optional(),
    message: z.enum(Object.values(CONNECTOR_MAPPING_MESSAGES)),
  })
  .strict()
  .refine(
    (issue) => issue.message === CONNECTOR_MAPPING_MESSAGES[issue.code],
    "Use the fixed actionable message for this category",
  );
export const previewConnectorFieldMappingInputSchema = z
  .object({ fields: connectorFieldMappingsSchema })
  .strict();
export const saveConnectorFieldMappingInputSchema =
  previewConnectorFieldMappingInputSchema
    .extend({
      expectedVersion: version,
      expectedMappingRevision: version,
      idempotencyKey: z.uuid(),
      schemaDigest: digest,
    })
    .strict();
export const connectorMappingPreviewSchema = z
  .object({
    schema: connectorMappingDiscoverySchema,
    fields: connectorFieldMappingsSchema,
    issues: z.array(connectorMappingIssueSchema).max(1_000),
    samples: z
      .array(
        z
          .object({
            entityType: entity,
            externalId: z.string().min(1).max(500),
            fields: z.record(
              field,
              z.union([
                z.string().max(4_000),
                z.number().finite(),
                z.boolean(),
                z.null(),
              ]),
            ),
          })
          .strict(),
      )
      .max(10),
    valid: z.boolean(),
  })
  .strict()
  .refine(
    (preview) => preview.valid === (preview.issues.length === 0),
    "Validity must match the validation issues",
  );
export const connectorMappingSchemaResponseSchema = z
  .object({ schema: connectorMappingDiscoverySchema })
  .strict();
export const connectorFieldMapResponseSchema = z
  .object({ mapping: connectorFieldMapSchema })
  .strict();
export const connectorMappingPreviewResponseSchema = z
  .object({ preview: connectorMappingPreviewSchema })
  .strict();
export const syncHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
  })
  .strict();
export const syncRunHistorySchema = z
  .object({
    run: syncRunSchema,
    startedAt: timestamp.nullable(),
    finishedAt: timestamp.nullable(),
    version,
    fieldMappingRevision: version.nullable(),
    replayOfRunId: z.uuid().nullable(),
    counts: z
      .object({
        succeeded: version,
        skipped: version,
        failed: version,
        pending: version,
      })
      .strict(),
    retryAt: timestamp.nullable(),
  })
  .strict();
export const syncFailureCategorySchema = z.enum([
  "timeout",
  "rate_limit",
  "provider_unavailable",
  "transient_database",
  "authentication",
  "invalid_data",
  "unsupported",
  "authorization",
  "stale_preview",
  "interrupted",
  "unknown",
]);
export const syncRunAttemptSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    generation: z.number().int().positive(),
    phase: z.enum(["dry_run", "commit"]),
    startedAt: timestamp,
    finishedAt: timestamp.nullable(),
    outcome: z.enum([
      "running",
      "succeeded",
      "review_required",
      "retrying",
      "failed",
      "interrupted",
    ]),
    errorCategory: syncFailureCategorySchema.nullable(),
    errorCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,99}$/)
      .nullable(),
    nextAttemptAt: timestamp.nullable(),
    recordIds: z.array(z.uuid()).max(200),
  })
  .strict();
export const syncRecordOutcomeSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    externalId: z.string().min(1).max(500),
    entityType: entity,
    proposedAction: z.enum([
      "create",
      "update",
      "unchanged",
      "archive",
      "conflict",
      "ambiguous_match",
      "pending_required_fields",
      "rejected",
      "skipped_tombstone",
    ]),
    outcome: z.enum(["pending", "succeeded", "skipped", "failed", "withheld"]),
    errorCategory: syncFailureCategorySchema.nullable(),
    errorCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,99}$/)
      .nullable(),
    deadLetteredAt: timestamp.nullable(),
    appliedAt: timestamp.nullable(),
  })
  .strict();
export const syncRunHistoryResponseSchema = z
  .object({ runs: pagedSchema(syncRunHistorySchema) })
  .strict();
export const syncRunDetailResponseSchema = z
  .object({
    run: syncRunHistorySchema,
    attempts: pagedSchema(syncRunAttemptSchema),
    records: pagedSchema(syncRecordOutcomeSchema),
  })
  .strict();
export const syncDeadLettersResponseSchema = z
  .object({ records: pagedSchema(syncRecordOutcomeSchema) })
  .strict();
export const replaySyncRunPreviewInputSchema = z
  .object({
    expectedVersion: version,
    mappingMode: z.enum(["preserve", "rebase"]),
    sourceMode: z.enum(["retained", "refetch"]),
  })
  .strict();
export const replaySyncRunPreviewSchema = z
  .object({
    previewDigest: digest,
    runId: z.uuid(),
    runVersion: version,
    mappingRevision: version,
    mappingMode: z.enum(["preserve", "rebase"]),
    sourceMode: z.enum(["retained", "refetch"]),
    recordCount: z.number().int().min(0).max(200),
    proposedCounts: z
      .object({
        create: version,
        update: version,
        unchanged: version,
        skip: version,
        conflict: version,
        failed: version,
      })
      .strict(),
    samples: z
      .array(
        z
          .object({
            entityType: entity,
            externalId: z.string().min(1).max(500),
            proposedAction: z.enum([
              "create",
              "update",
              "unchanged",
              "archive",
              "conflict",
              "ambiguous_match",
              "pending_required_fields",
              "rejected",
              "skipped_tombstone",
            ]),
          })
          .strict(),
      )
      .max(10),
    issues: z.array(connectorMappingIssueSchema).max(1_000),
    canReplay: z.boolean(),
  })
  .strict();
export const replaySyncRunPreviewResponseSchema = z
  .object({ preview: replaySyncRunPreviewSchema })
  .strict();
export const replaySyncRunInputSchema = replaySyncRunPreviewInputSchema
  .extend({
    idempotencyKey: z.uuid(),
    previewDigest: digest,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
/** Provider bodies are parsed and raw payloads are discarded before use. */
export const connectorExternalRecordSchema = z.object({
  entityType: entity,
  externalId: z.string().min(1).max(500),
  externalDisplayLabel: z.string().min(1).max(500),
  externalUpdatedAt: timestamp,
  changeKind: z.enum(["upsert", "tombstone"]),
  tombstoneReliability: z.enum(["confirmed", "unknown"]),
  parentExternalId: z.string().min(1).max(500).nullable(),
  fields: z
    .record(
      field,
      z.union([
        z.string().max(4_000),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    )
    .refine((values) => Object.keys(values).length <= 100),
});
export const connectorPullPageSchema = z
  .object({
    records: z.array(connectorExternalRecordSchema).max(200),
    nextCursor: z
      .object({ token: z.string().max(8_000), watermark: z.string().max(500) })
      .strict()
      .nullable(),
    adapterSignal: z.enum([
      "ok",
      "cursor_expired",
      "cursor_invalid",
      "rate_limited",
      "unavailable",
    ]),
    retryAfterSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();
