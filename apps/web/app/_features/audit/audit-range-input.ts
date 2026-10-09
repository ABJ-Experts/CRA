import {
  auditRangeCheckpointSchema,
  auditRangeCreateInputSchema,
} from "@repo/contracts/audit/schemas";
export function parseAuditRangeDraft(
  requestId: string,
  from: string,
  to: string,
  checkpoint: string,
) {
  if (new TextEncoder().encode(checkpoint).byteLength > 16_384)
    throw new Error("Checkpoint must be at most 16 KiB.");
  const priorCheckpoint = checkpoint.trim()
    ? auditRangeCheckpointSchema.parse(JSON.parse(checkpoint))
    : undefined;
  return auditRangeCreateInputSchema.parse({
    requestId,
    fromSequence: from.trim(),
    ...(to.trim() ? { toSequence: to.trim() } : {}),
    ...(priorCheckpoint ? { priorCheckpoint } : {}),
  });
}
