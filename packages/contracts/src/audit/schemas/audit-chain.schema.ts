import { z } from "zod";

/** PostgreSQL bigint crosses JSON boundaries as decimal text, never a JS number. */
export const auditSequenceSchema = z
  .string()
  .max(19)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) =>
      value.length < 19 ||
      (value.length === 19 && value <= "9223372036854775807"),
  );
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const auditChainRequestSchema = z
  .object({
    organizationId: z.uuid(),
    fromSequence: auditSequenceSchema
      .refine((value) => value !== "0")
      .default("1"),
    toSequence: auditSequenceSchema.optional(),
    pageSize: z.number().int().min(1).max(1000).default(250),
    maxEvents: z.number().int().min(1).max(10000000).default(1000000),
  })
  .strict()
  .refine(
    (value) =>
      value.toSequence === undefined ||
      value.toSequence.length > value.fromSequence.length ||
      (value.toSequence.length === value.fromSequence.length &&
        value.toSequence >= value.fromSequence),
    { message: "Invalid sequence range" },
  );
export const auditChainRetentionSchema = z
  .object({
    protected_through: z.iso.datetime({ offset: true }).nullable(),
    required_retention_days: z.number().int().nonnegative(),
    retention_status: z.enum(["unknown", "protected", "complete"]),
    retention_checked_at: z.iso.datetime({ offset: true }).nullable(),
    legal_hold: z.boolean(),
  })
  .strict();
export const auditChainSnapshotSchema = z
  .object({
    organization_id: z.uuid(),
    activation_at: z.iso.datetime({ offset: true }),
    ...auditChainRetentionSchema.shape,
    legacy_count: auditSequenceSchema,
    last_sequence: auditSequenceSchema,
    last_event_id: z.uuid().nullable(),
    last_hash: hashSchema,
    chain_version: z.number().int(),
  })
  .strict();
export const auditChainRowSchema = z
  .object({
    id: z.uuid(),
    chain_version: z.number().int(),
    chain_sequence: auditSequenceSchema,
    previous_hash: hashSchema,
    content_hash: hashSchema,
    canonical_content: z.string().max(16777216),
    recomputed_canonical_content: z.string().max(16777216),
  })
  .strict();
export const auditChainPageSchema = z.array(auditChainRowSchema).max(1000);
export const auditChainResultSchema = z
  .object({
    organizationId: z.uuid(),
    status: z.enum(["verified", "corrupt", "incomplete"]),
    reason: z
      .enum([
        "canonical_mismatch",
        "unsupported_version",
        "hash_mismatch",
        "previous_hash_mismatch",
        "sequence_gap",
        "head_mismatch",
        "read_failed",
        "range_unavailable",
        "event_limit",
      ])
      .nullable(),
    activationAt: z.iso.datetime({ offset: true }).nullable(),
    legacyCount: auditSequenceSchema,
    fromSequence: auditSequenceSchema,
    upperSequence: auditSequenceSchema,
    verifiedCount: auditSequenceSchema,
    checkpointHash: hashSchema.nullable(),
    checkpointSequence: auditSequenceSchema.nullable(),
    fullChain: z.boolean(),
    retention: auditChainRetentionSchema.nullable(),
    archivalRequired: z.literal(true),
  })
  .strict();
