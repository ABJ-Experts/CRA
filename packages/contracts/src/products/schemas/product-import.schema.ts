import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";
import { z } from "zod";

const safeText = (maxLength: number) => z.string().trim().min(1).max(maxLength);
const hashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");
const timestampSchema = z.iso.datetime({ offset: true });

/** The V1 CSV value that is persisted with every dry run and commit. */
export const productImportSchemaVersionSchema = z.literal(
  "m2-product-release-import-v1",
);
export const productImportTemplateFilename =
  "product-release-import-v1.csv" as const;
export const productImportReportFilename =
  "product-release-import-report.csv" as const;
export const productImportCsvContentType = "text/csv; charset=utf-8" as const;

/** Published operational limits. The parser enforces them before planning. */
export const productImportMaxBytes = 10 * 1024 * 1024;
export const productImportMaxRows = 10_000;
export const productImportSyncRowThreshold = 1_000;
export const productImportDryRunExpiryHours = 24;
export const productImportReportLinkTtlSeconds = 5 * 60;

/** Durable states; upload progress is browser-only until a job is created. */
export const productImportStatusSchema = z.enum([
  "queued",
  "parsing",
  "validating",
  "dry_run_completed",
  "dry_run_failed",
  "committing",
  "retrying",
  "dead_letter",
  "stale_conflict",
  "canceled",
  "expired",
  "completed",
]);

export const productImportRowTypeSchema = z.enum(["product", "release"]);

/** CSV commands. `unchanged`, `skipped`, and `failed` are planner outcomes. */
export const productImportRowOperationSchema = z.enum(["create", "update"]);
export const productImportProposedActionSchema = z.enum([
  "create",
  "update",
  "unchanged",
  "skipped",
  "failed",
]);
export const productImportRowResultSchema = z.enum([
  "planned",
  "committed",
  "failed",
  "skipped",
]);
export const productImportIssueSeveritySchema = z.enum(["warning", "error"]);

/**
 * Public codes are deliberately finite: callers receive no database details,
 * foreign-tenant existence information, raw input, or storage errors.
 */
export const productImportIssueCodeSchema = z.enum([
  "empty_file",
  "no_data_rows",
  "file_too_large",
  "too_many_rows",
  "compressed_input",
  "invalid_utf8",
  "null_byte",
  "malformed_csv",
  "row_too_large",
  "cell_too_large",
  "missing_header",
  "duplicate_header",
  "ambiguous_header",
  "unknown_column",
  "invalid_column_count",
  "unsupported_schema_version",
  "invalid_record_type",
  "invalid_operation",
  "required",
  "invalid_format",
  "invalid_value",
  "unexpected_value",
  "duplicate_in_file",
  "conflicting_row",
  "already_exists",
  "not_found",
  "inactive",
  "stale_version",
  "no_changes",
  "content_hash_mismatch",
  "source_missing",
  "authorization_changed",
  "permission_denied",
  "validation_failed",
  "stale_conflict",
  "canceled",
  "expired",
  "retry_exhausted",
  "unavailable",
]);

export const productImportFieldSchema = z.enum([
  "file",
  "header",
  "format_version",
  "record_type",
  "operation",
  "product_internal_code",
  "product_name",
  "product_type",
  "product_description",
  "owner_email",
  "legal_entity_identifier",
  "release_version",
  "release_label",
  "release_description",
  "expected_version",
]);

export const productImportFieldIssueSchema = z
  .object({
    field: productImportFieldSchema,
    code: productImportIssueCodeSchema,
    /** A controlled, localisable message; never an echoed CSV cell. */
    message: safeText(500),
    severity: productImportIssueSeveritySchema,
  })
  .strict();

export const productImportCountsSchema = z
  .object({
    create: z.number().int().nonnegative(),
    update: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  })
  .strict();

/** Storage-path, actor, owner, and row-plan payload free public job view. */
export const productImportSchema = z
  .object({
    id: z.uuid(),
    schemaVersion: productImportSchemaVersionSchema,
    status: productImportStatusSchema,
    contentHash: hashSchema,
    byteSize: z.number().int().nonnegative().max(productImportMaxBytes),
    rowCount: z.number().int().nonnegative().max(productImportMaxRows),
    processedRowCount: z.number().int().nonnegative().max(productImportMaxRows),
    counts: productImportCountsSchema,
    errorCode: productImportIssueCodeSchema.nullable(),
    expiresAt: timestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    committedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.processedRowCount > value.rowCount) {
      context.addIssue({
        code: "custom",
        path: ["processedRowCount"],
        message: "Processed rows cannot exceed total rows",
      });
    }
    if (value.status === "completed" && value.committedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["committedAt"],
        message: "Completed imports require a commit timestamp",
      });
    }
  });

/**
 * Successful rows expose only canonical business identifiers. Failed rows do
 * not echo arbitrary source values or database identifiers.
 */
export const productImportRowSchema = z
  .object({
    sourceRowNumber: z.number().int().positive(),
    rowType: productImportRowTypeSchema.nullable(),
    proposedAction: productImportProposedActionSchema,
    result: productImportRowResultSchema,
    productInternalCode: safeText(128).nullable(),
    releaseVersion: safeText(200).nullable(),
    issues: z.array(productImportFieldIssueSchema).max(50),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedResult =
      value.proposedAction === "failed"
        ? "failed"
        : value.proposedAction === "skipped"
          ? "skipped"
          : null;
    if (expectedResult !== null && value.result !== expectedResult) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "The final result must agree with the proposed action",
      });
    }
    if (
      value.result === "failed" &&
      !value.issues.some((issue) => issue.severity === "error")
    ) {
      context.addIssue({
        code: "custom",
        path: ["issues"],
        message: "Failed rows require a field error",
      });
    }
  });

export const productImportResponseSchema = z
  .object({ import: productImportSchema })
  .strict();
export const productImportsResponseSchema = z
  .object({ imports: pagedSchema(productImportSchema) })
  .strict();
export const productImportRowsResponseSchema = z
  .object({ rows: pagedSchema(productImportRowSchema) })
  .strict();

/** Multipart file contents are validated by the streaming upload boundary. */
export const productImportUploadFieldsSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const productImportCommitInputSchema = z
  .object({ contentHash: hashSchema, idempotencyKey: idempotencyKeySchema })
  .strict();

export const productImportCancelInputSchema = z
  .object({ reason: safeText(500).optional() })
  .strict();

export const productImportParamsSchema = z
  .object({ importId: z.uuid() })
  .strict();

export const productImportListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
    status: productImportStatusSchema.optional(),
  })
  .strict();

export const productImportRowsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    result: productImportRowResultSchema.optional(),
  })
  .strict();

export const productImportTemplateResponseSchema = z
  .object({
    schemaVersion: productImportSchemaVersionSchema,
    filename: z.literal(productImportTemplateFilename),
    contentType: z.literal(productImportCsvContentType),
    csv: z.string().min(1),
  })
  .strict();

/** A signed URL is short lived and is not a storage key. */
export const productImportReportLinkResponseSchema = z
  .object({
    report: z
      .object({
        filename: z.literal(productImportReportFilename),
        contentType: z.literal(productImportCsvContentType),
        downloadUrl: z.url(),
        expiresAt: timestampSchema,
      })
      .strict(),
  })
  .strict();
