import { pageParamsSchema } from "../../pagination/schemas/pagination.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");
const errorCodeSchema = z
  .string()
  .regex(/^[a-z0-9_]{1,120}$/, "Use a lowercase snake_case error code");

export const syncReconciliationKindSchema = z.enum(["incremental", "full"]);
export const syncWorkKindSchema = z.enum(["dry_run", "commit"]);
export const syncRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_for_review",
  "retrying",
  "failed",
  "canceled",
  "completed",
]);
export const syncEntityTypeSchema = z.enum(["product", "release"]);
/** Must stay exactly in sync with sync_run_plan_items_proposed_action_check. */
export const syncProposedActionSchema = z.enum([
  "create",
  "update",
  "unchanged",
  "archive",
  "conflict",
  "ambiguous_match",
  "pending_required_fields",
  "rejected",
  "skipped_tombstone",
]);
/** The three actions a resolver may take on a single field diff or conflict. */
export const syncPermittedFieldActionSchema = z.enum([
  "accept_external",
  "keep_cra",
  "enter_manual_value",
]);

export const syncRunParamsSchema = z
  .object({ connectorId: z.uuid(), syncRunId: z.uuid() })
  .strict();

export const beginSyncRunInputSchema = z
  .object({
    reconciliationKind: syncReconciliationKindSchema,
    idempotencyKey: z.uuid(),
  })
  .strict();

export const requestSyncRunCommitInputSchema = z
  .object({ expectedRowCount: z.number().int().min(0).nullable().optional() })
  .strict();

export const cancelSyncRunInputSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

/** Every mutation below has a real body; a retry does not. */
export const retrySyncRunInputSchema = z.object({}).strict();

/** `GET .../sync-runs` combines the shared pagination envelope with a
 * status filter; reuses `pageParamsSchema`'s parse so page/pageSize/sort
 * defaulting stays in one place. */
export const syncRunListQuerySchema = z
  .object({
    page: z.unknown().optional(),
    pageSize: z.unknown().optional(),
    sort: z.unknown().optional(),
    order: z.unknown().optional(),
    q: z.unknown().optional(),
    status: syncRunStatusSchema.optional(),
  })
  .transform((input) => ({
    ...pageParamsSchema.parse(input),
    ...(input.status === undefined ? {} : { status: input.status }),
  }));

export const syncRunCountsSchema = z
  .object({
    create: z.number().int().nonnegative(),
    update: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    skip: z.number().int().nonnegative(),
    conflict: z.number().int().nonnegative(),
    tombstone: z.number().int().nonnegative(),
    cycleBlocked: z.number().int().nonnegative(),
  })
  .strict();

export const syncRunSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    connectorId: z.uuid(),
    reconciliationKind: syncReconciliationKindSchema,
    workKind: syncWorkKindSchema,
    status: syncRunStatusSchema,
    adapterVersion: requiredText(100),
    mappingVersion: requiredText(100),
    cursorFrom: z.string().nullable(),
    cursorTo: z.string().nullable(),
    fetchContentHash: sha256Schema.nullable(),
    planBasisDigest: sha256Schema.nullable(),
    /** Exact durable plan row count used for optimistic commit approval. */
    rowCount: z.number().int().nonnegative(),
    counts: syncRunCountsSchema,
    estimatedGraphImpact: z.record(z.string(), z.unknown()),
    errorCode: errorCodeSchema.nullable(),
    retryCount: z.number().int().min(0).max(5),
    correlationId: z.uuid(),
    expiresAt: utcZDateTimeSchema,
    committedAt: utcZDateTimeSchema.nullable(),
    canceledAt: utcZDateTimeSchema.nullable(),
    createdAt: utcZDateTimeSchema,
    updatedAt: utcZDateTimeSchema,
  })
  .strict()
  .superRefine((run, context) => {
    if ((run.status === "completed") !== (run.committedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["committedAt"],
        message:
          "A completed run requires a committed timestamp, and only a completed run carries one",
      });
    }
    if ((run.status === "canceled") !== (run.canceledAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["canceledAt"],
        message:
          "A canceled run requires a canceled timestamp, and only a canceled run carries one",
      });
    }
  });

const syncFieldDiffSchema = z
  .object({
    field: requiredText(100),
    craValue: z.unknown(),
    externalValue: z.unknown(),
    authorityPolicyId: z.uuid().nullable(),
    permittedActions: z.array(syncPermittedFieldActionSchema),
  })
  .strict();

const syncRunPlanItemIssueSchema = z
  .object({
    code: requiredText(100),
    message: requiredText(500),
    severity: z.enum(["warning", "error"]),
  })
  .strict();

/** The persisted dry-run plan row. Commit replays these, never recomputes the diff. */
export const syncRunPlanItemSchema = z
  .object({
    externalId: requiredText(500),
    entityType: syncEntityTypeSchema,
    proposedAction: syncProposedActionSchema,
    // jsonb object keyed by field name (sync_run_plan_items_field_diffs_check
    // requires jsonb_typeof(field_diffs) = 'object'), not an array.
    fieldDiffs: z.record(z.string(), syncFieldDiffSchema),
    issues: z.array(syncRunPlanItemIssueSchema),
  })
  .strict();
