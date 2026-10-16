import { z } from "zod";
import {
  auditChainResultSchema,
  auditSequenceSchema,
} from "./audit-chain.schema.js";
import { auditRequestIdSchema } from "./audit-event.schema.js";
import { auditSha256Schema } from "./audit-explorer.schema.js";

const instant = z.iso.datetime({ offset: true });
const positiveSequence = auditSequenceSchema.refine((value) => value !== "0");
const ordered = (from: string, to: string) => BigInt(from) <= BigInt(to);
const compactCheckpoint = z
  .object({
    organizationId: z.uuid(),
    activationAt: instant,
    chainVersion: z.literal(1),
    sequence: positiveSequence,
    hash: auditSha256Schema,
  })
  .strict();
/** Saved M13-02 operator output is accepted only when a checked checkpoint exists. */
const operatorCheckpoint = auditChainResultSchema
  .refine(
    (value) =>
      value.status === "verified" &&
      value.activationAt !== null &&
      value.checkpointSequence !== null &&
      value.checkpointSequence !== "0" &&
      value.checkpointHash !== null,
    { message: "A verified operator checkpoint is required" },
  )
  .transform((value) => ({
    organizationId: value.organizationId,
    activationAt: value.activationAt!,
    chainVersion: 1 as const,
    sequence: value.checkpointSequence!,
    hash: value.checkpointHash!,
  }));
export const auditRangeCheckpointSchema = z.union([
  compactCheckpoint,
  operatorCheckpoint,
]);
export const auditRangeCreateInputSchema = z
  .object({
    requestId: auditRequestIdSchema,
    fromSequence: positiveSequence.default("1"),
    toSequence: positiveSequence.optional(),
    priorCheckpoint: auditRangeCheckpointSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.toSequence === undefined ||
      ordered(value.fromSequence, value.toSequence),
    { message: "Invalid sequence range" },
  );
export const auditRangeOperationInputSchema = z
  .object({
    requestId: auditRequestIdSchema,
    expectedVersion: z.number().int().min(0).max(2_147_483_647),
  })
  .strict();
export const auditRangeParamsSchema = z.object({ jobId: z.uuid() }).strict();
export const auditRangeStatusQuerySchema = z
  .object({ requestId: auditRequestIdSchema })
  .strict();
export const auditRangeStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "stale",
]);
export const auditRangeOutcomeSchema = z.enum([
  "consistent",
  "integrity_break",
  "empty",
  "legacy_unchained",
  "checkpoint_unavailable",
  "scope_unavailable",
  "incomplete",
]);
export const auditRangeBoundarySchema = z
  .object({ from: positiveSequence, to: positiveSequence })
  .strict()
  .refine((value) => ordered(value.from, value.to), {
    message: "Invalid sequence boundary",
  });
export const auditRangeBreakCategorySchema = z.enum([
  "predecessor_failure",
  "missing_sequence_interval",
  "duplicate_sequence",
  "reordered_rows",
  "canonical_mismatch",
  "hash_mismatch",
  "previous_link_mismatch",
  "unsupported_version",
  "frozen_boundary_mismatch",
  "head_mismatch",
  "prior_checkpoint_mismatch",
]);
/** Structural locations only: no event identifiers, content, or expected/actual hashes. */
export const auditRangeBreakSchema = z
  .object({
    category: auditRangeBreakCategorySchema,
    fromSequence: positiveSequence,
    toSequence: positiveSequence,
  })
  .strict()
  .refine((value) => ordered(value.fromSequence, value.toSequence), {
    message: "Invalid break interval",
  });
export const auditRangeResultSchema = z
  .object({
    outcome: auditRangeOutcomeSchema,
    algorithm: z.literal("sha256"),
    chainVersion: z.literal(1),
    requestedRange: z
      .object({ from: positiveSequence, to: positiveSequence.nullable() })
      .strict()
      .refine((value) => value.to === null || ordered(value.from, value.to), {
        message: "Invalid requested range",
      }),
    frozenRange: auditRangeBoundarySchema.nullable(),
    checkedRange: auditRangeBoundarySchema.nullable(),
    verifiedPrefix: auditRangeBoundarySchema.nullable(),
    checkedCount: auditSequenceSchema.nullable(),
    firstAffectedSequence: positiveSequence.nullable(),
    breaks: z.array(auditRangeBreakSchema).max(100),
    sampleSequences: z.array(positiveSequence).max(100),
    inspectionComplete: z.boolean(),
    checkedAt: instant.nullable(),
    datasetContext: z.enum(["unknown", "live", "restored"]),
    priorCheckpointStatus: z.enum([
      "not_supplied",
      "matched",
      "mismatch",
      "ahead",
      "unavailable",
    ]),
    authenticityProven: z.literal(false),
    completeLedgerVerified: z.literal(false),
  })
  .strict()
  .superRefine((result, context) => {
    const hidden = result.outcome === "scope_unavailable";
    if (
      hidden &&
      (result.frozenRange !== null ||
        result.checkedRange !== null ||
        result.verifiedPrefix !== null ||
        result.checkedCount !== null ||
        result.firstAffectedSequence !== null ||
        result.breaks.length !== 0 ||
        result.sampleSequences.length !== 0 ||
        result.inspectionComplete ||
        !["unavailable", "not_supplied"].includes(result.priorCheckpointStatus))
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable scope must suppress evidence and progress",
      });
    }
    if (
      result.outcome === "consistent" &&
      (!result.inspectionComplete ||
        result.checkedAt === null ||
        result.frozenRange === null ||
        result.checkedRange === null ||
        result.verifiedPrefix === null ||
        result.checkedCount === null ||
        result.checkedCount === "0" ||
        result.breaks.length !== 0 ||
        result.firstAffectedSequence !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Consistency requires a completed nonempty check without breaks",
      });
    }
    if (
      result.breaks.length > 0 !== (result.firstAffectedSequence !== null) ||
      (result.outcome === "integrity_break" && result.breaks.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Integrity breaks must identify the first affected sequence",
      });
    }
    const boundary = result.frozenRange;
    if (result.outcome === "consistent" && boundary !== null) {
      const completeRange = [result.checkedRange, result.verifiedPrefix].every(
        (range) =>
          range !== null &&
          range.from === boundary.from &&
          range.to === boundary.to,
      );
      const expectedCount = (
        BigInt(boundary.to) -
        BigInt(boundary.from) +
        1n
      ).toString();
      if (
        !completeRange ||
        result.checkedCount !== expectedCount ||
        !["not_supplied", "matched"].includes(result.priorCheckpointStatus)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Consistency requires complete range coverage and matching supplied checkpoint",
        });
      }
    }
    for (const range of [result.checkedRange, result.verifiedPrefix]) {
      if (
        range !== null &&
        (boundary === null ||
          !ordered(boundary.from, range.from) ||
          !ordered(range.to, boundary.to))
      ) {
        context.addIssue({
          code: "custom",
          message: "Checked boundaries must remain inside the frozen range",
        });
      }
    }
  });
export const auditRangeFailureCodeSchema = z.enum([
  "access_changed",
  "dataset_changed",
  "provider_unavailable",
  "event_limit",
  "byte_limit",
  "attempt_limit",
  "verification_failed",
  "checkpoint_unavailable",
]);
export const auditRangeJobSchema = z
  .object({
    id: z.uuid(),
    status: auditRangeStatusSchema,
    version: z.number().int().min(0).max(2_147_483_647),
    createdAt: instant,
    updatedAt: instant,
    result: auditRangeResultSchema.nullable(),
    failureCode: auditRangeFailureCodeSchema.nullable(),
  })
  .strict()
  .refine((job) => job.status !== "completed" || job.result !== null, {
    message: "Completed verification requires a result",
  })
  .refine(
    (job) => job.result?.outcome !== "consistent" || job.status === "completed",
    {
      message: "Consistency requires completed workflow",
    },
  );
