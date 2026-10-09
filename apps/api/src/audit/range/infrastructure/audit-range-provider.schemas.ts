import { z } from "zod";
import {
  auditChainRowSchema,
  auditSequenceSchema,
  auditSha256Schema,
  auditRangeBreakSchema,
  auditRangeCheckpointSchema,
  auditRangeResultSchema,
  auditRangeJobSchema,
} from "@repo/contracts/audit/schemas";
import type { AuditRangeWorkerJob } from "../audit-range-worker.port";
export const auditRangeCursorProviderSchema = z
  .object({
    nextSequence: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .max(19)
      .refine((value) => BigInt(value) <= 9223372036854775808n),
    previousHash: auditSha256Schema,
    lastEventId: z.uuid().nullable(),
    checkedCount: auditSequenceSchema,
    checkedFrom: auditSequenceSchema.nullable(),
    checkedTo: auditSequenceSchema.nullable(),
    verifiedPrefixTo: auditSequenceSchema.nullable(),
    breaks: z.array(auditRangeBreakSchema).max(100),
    sampleSequences: z.array(auditSequenceSchema).max(100),
    exhausted: z.boolean(),
  })
  .strict();
const frozenHeadSchema = z
  .object({
    last_sequence: auditSequenceSchema,
    last_hash: z.string().max(128),
    last_event_id: z.uuid().nullable(),
    chain_version: z.number().int().optional(),
  })
  .strip();
const rawWorkerJobSchema = z
  .object({
    id: z.uuid(),
    organization_id: z.uuid(),
    version: z.number().int().min(0).max(2147483647),
    worker_id: z.string().min(1).max(128),
    lease_token: z.uuid(),
    phase: z.enum(["authorization", "verification"]),
    from_sequence: auditSequenceSchema,
    to_sequence: auditSequenceSchema,
    requested_to_sequence: auditSequenceSchema.nullable(),
    frozen_head: frozenHeadSchema.nullable(),
    frozen_boundary: z
      .object({
        sequence: auditSequenceSchema,
        hash: z.string().max(128),
        eventId: z.uuid().nullable(),
        chainVersion: z.number().int().optional(),
      })
      .nullable(),
    predecessor: auditChainRowSchema.nullable(),
    cursor: auditRangeCursorProviderSchema.nullable(),
    dataset_context: auditRangeResultSchema.shape.datasetContext,
    legacy_count: auditSequenceSchema,
    prior_checkpoint: auditRangeCheckpointSchema.nullable(),
    prior_checkpoint_status: auditRangeResultSchema.shape.priorCheckpointStatus,
  })
  .strip();
export const auditRangeWorkerJobProviderSchema = rawWorkerJobSchema.transform(
  (row): AuditRangeWorkerJob => ({
    id: row.id,
    organizationId: row.organization_id,
    version: row.version,
    workerId: row.worker_id,
    leaseToken: row.lease_token,
    phase: row.phase,
    fromSequence: row.from_sequence,
    toSequence: row.to_sequence,
    requestedToSequence: row.requested_to_sequence,
    head: row.frozen_head
      ? {
          sequence: row.frozen_head.last_sequence,
          hash: row.frozen_head.last_hash,
          eventId: row.frozen_head.last_event_id,
          chainVersion: row.frozen_head.chain_version,
        }
      : null,
    boundary: row.frozen_boundary,
    predecessor: row.predecessor,
    cursor: row.cursor,
    datasetContext: row.dataset_context,
    legacyCount: row.legacy_count,
    priorCheckpoint: row.prior_checkpoint
      ? {
          sequence: row.prior_checkpoint.sequence,
          hash: row.prior_checkpoint.hash,
          eventId: null,
        }
      : null,
    priorCheckpointStatus: row.prior_checkpoint_status,
  }),
);
export const authorizationProviderSchema = z
  .object({
    job: auditRangeWorkerJobProviderSchema,
    complete: z.boolean(),
    scopeAvailable: z.boolean(),
  })
  .strict();
export const revalidationProviderSchema = z
  .object({
    job: auditRangeWorkerJobProviderSchema,
    anchorsValid: z.boolean(),
    scopeAvailable: z.boolean(),
  })
  .strict();
export const rangePageProviderSchema = z
  .object({
    rows: z.array(auditChainRowSchema).max(250),
    exhausted: z.boolean(),
  })
  .strict();

export const auditRangeMutationProviderSchema = z
  .object({
    id: z.uuid(),
    organization_id: z.uuid(),
    state: auditRangeJobSchema.shape.status,
    version: auditRangeJobSchema.shape.version,
    result: auditRangeResultSchema.nullable(),
    failure_code: auditRangeJobSchema.shape.failureCode,
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strip();
