import { z } from "zod";
import { auditSequenceSchema } from "./audit-chain.schema.js";
import { auditRequestIdSchema } from "./audit-event.schema.js";

const instant = z.iso.datetime({ offset: true });
const opaqueToken = z
  .string()
  .min(1)
  .max(6000)
  .regex(/^[A-Za-z0-9_.~-]+$/);
const identifier = z.string().trim().min(1).max(200);
export const auditSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
/** Filters represent instants; interval is UTC [from,to), never inclusive end. */
export const auditSearchFiltersSchema = z
  .object({
    from: instant,
    to: instant,
    actorId: identifier.optional(),
    action: z.string().trim().min(1).max(120).optional(),
    resourceType: z.string().trim().min(1).max(80).optional(),
    resourceId: identifier.optional(),
    correlationId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (value) => {
      const duration = Date.parse(value.to) - Date.parse(value.from);
      return duration > 0 && duration <= 366 * 24 * 60 * 60 * 1000;
    },
    { message: "Use a positive date range of at most 366 days" },
  );
export const auditSearchInputSchema = z
  .object({
    requestId: auditRequestIdSchema,
    filters: auditSearchFiltersSchema,
  })
  .strict();
export const auditSnapshotSchema = z
  .object({
    snapshotToken: opaqueToken,
    expiresAt: instant,
    filters: auditSearchFiltersSchema,
  })
  .strict();
export const auditSnapshotParamsSchema = z
  .object({ snapshotToken: opaqueToken })
  .strict();
export const auditDetailParamsSchema = z
  .object({ snapshotToken: opaqueToken, eventId: z.uuid() })
  .strict();
export const auditOperationQuerySchema = z
  .object({ requestId: auditRequestIdSchema })
  .strict();
export const auditPageQuerySchema = z
  .object({
    requestId: auditRequestIdSchema,
    cursor: opaqueToken.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const auditVerificationStatusSchema = z.enum([
  "not_verified",
  "event_hashes_checked",
  "legacy_unchained",
  "integrity_break",
]);
export const auditEventViewSchema = z
  .object({
    id: z.uuid(),
    sequence: auditSequenceSchema.refine((value) => value !== "0").nullable(),
    legacy: z.boolean(),
    createdAt: instant,
    actor: z
      .object({
        id: identifier.nullable(),
        type: z.enum([
          "user",
          "service_account",
          "system",
          "ai",
          "operator",
          "unknown",
        ]),
        label: z.string().max(200).nullable(),
      })
      .strict(),
    action: z.string().min(1).max(120),
    resourceType: z.string().min(1).max(80),
    resourceId: identifier.nullable(),
    correlationId: z.uuid().nullable(),
    outcome: z.string().max(80).nullable(),
    verificationStatus: auditVerificationStatusSchema,
  })
  .strict()
  .refine(
    (row) =>
      row.legacy === (row.sequence === null) &&
      (row.legacy
        ? row.verificationStatus === "legacy_unchained"
        : row.verificationStatus !== "legacy_unchained"),
    { message: "Legacy rows have no sequence or verified chain status" },
  );
export const auditPageSchema = z
  .object({
    items: z.array(auditEventViewSchema).max(200),
    nextCursor: opaqueToken.nullable(),
  })
  .strict();
export const auditRedactedValuesSchema = z
  .record(z.string().max(80), z.json())
  .nullable();
export const auditDetailSchema = z
  .object({
    event: auditEventViewSchema,
    before: auditRedactedValuesSchema,
    after: auditRedactedValuesSchema,
    reason: z.string().max(200).nullable(),
  })
  .strict();
export const auditVerificationInputSchema = z
  .object({
    requestId: auditRequestIdSchema,
    eventIds: z
      .array(z.uuid())
      .min(1)
      .max(200)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Event IDs must be unique",
      ),
  })
  .strict();
export const auditVerificationResultSchema = z
  .object({
    checkedAt: instant,
    items: z
      .array(
        z
          .object({ eventId: z.uuid(), status: auditVerificationStatusSchema })
          .strict(),
      )
      .max(200),
    completenessProven: z.literal(false),
    authenticityProven: z.literal(false),
  })
  .strict();
export const auditExportFormatSchema = z.enum(["csv", "json"]);
export const auditExportInputSchema = z
  .object({
    requestId: auditRequestIdSchema,
    snapshotToken: opaqueToken,
    format: auditExportFormatSchema,
  })
  .strict();
export const auditExportParamsSchema = z.object({ jobId: z.uuid() }).strict();
export const auditExportStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "failed",
  "expired",
]);
export const auditExportJobSchema = z
  .object({
    id: z.uuid(),
    status: auditExportStatusSchema,
    format: auditExportFormatSchema,
    createdAt: instant,
    expiresAt: instant.nullable(),
    rowCount: z.number().int().min(0).max(100000).nullable(),
    packageHash: auditSha256Schema.nullable(),
    failureCode: z
      .enum([
        "access_changed",
        "integrity_break",
        "export_limit",
        "storage_unavailable",
        "generation_failed",
        "snapshot_expired",
      ])
      .nullable(),
  })
  .strict();
export const auditDownloadGrantInputSchema = z
  .object({ requestId: auditRequestIdSchema })
  .strict();
export const auditDownloadGrantSchema = z
  .object({
    url: z
      .string()
      .regex(/^\/api\/v1\/audit\/exports\/[0-9a-f-]{36}\/download$/),
    expiresAt: instant,
    packageHash: auditSha256Schema,
  })
  .strict();
/** Exact canonical bytes must survive independently of JSON numeric parsing. */
export const auditEventProofSchema = z
  .object({
    eventId: z.uuid(),
    sequence: auditSequenceSchema.refine((value) => value !== "0"),
    previousHash: auditSha256Schema,
    contentHash: auditSha256Schema,
    canonicalContent: z.string().min(1).max(16777216),
  })
  .strict();
export const auditExportManifestSchema = z
  .object({
    schema: z.literal("cra.audit-export.v1"),
    hashAlgorithm: z.literal("sha256"),
    organizationId: z.uuid(),
    scopeDigest: auditSha256Schema,
    filters: auditSearchFiltersSchema,
    format: auditExportFormatSchema,
    generatedAt: instant,
    timezone: z.literal("UTC"),
    ordering: z.literal("sequence_desc_then_legacy_created_at_id_desc"),
    sequenceRange: z
      .object({
        from: auditSequenceSchema.nullable(),
        to: auditSequenceSchema.nullable(),
      })
      .strict(),
    rowCount: z.number().int().min(0).max(100000),
    legacyCount: z.number().int().min(0).max(100000),
    proofCount: z.number().int().min(0).max(100000),
    files: z
      .array(
        z
          .object({
            name: z.enum([
              "events.csv",
              "events.json",
              "proofs.ndjson",
              "verify.mjs",
            ]),
            sha256: auditSha256Schema,
            bytes: z.number().int().min(0).max(268435456),
          })
          .strict(),
      )
      .min(3)
      .max(4),
    completenessProven: z.literal(false),
    authenticityProven: z.literal(false),
  })
  .strict()
  .superRefine((manifest, context) => {
    const chainedCount = manifest.rowCount - manifest.legacyCount;
    const range = manifest.sequenceRange;
    const validRange =
      chainedCount === 0
        ? range.from === null && range.to === null
        : range.from !== null &&
          range.to !== null &&
          range.from !== "0" &&
          BigInt(range.from) <= BigInt(range.to);
    const expectedFiles = [
      `events.${manifest.format}`,
      "proofs.ndjson",
      "verify.mjs",
    ];
    const validFiles =
      manifest.files.length === expectedFiles.length &&
      expectedFiles.every(
        (name) =>
          manifest.files.filter((file) => file.name === name).length === 1,
      );
    if (
      chainedCount < 0 ||
      manifest.proofCount > chainedCount ||
      !validRange ||
      !validFiles
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Manifest counts, sequence range, and artifact names must agree",
      });
    }
  });
