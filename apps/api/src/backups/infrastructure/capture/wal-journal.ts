import { z } from "zod";
import { BackupExecutionError } from "../../application/backup-execution.port";
import { assertWalSequence, walOrdinal } from "./wal-sequence";

export const WAL_SEGMENT_BYTES = 16 * 1024 * 1024;
const segmentName = /^[A-F0-9]{24}$/;
const historyName = /^[A-F0-9]{8}\.history$/;
export const partSchema = z.strictObject({
  id: z.uuid(),
  keyId: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,63}$/)
    .optional(),
  kind: z.literal("wal"),
  name: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(WAL_SEGMENT_BYTES),
  cipherSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cipherBytes: z
    .number()
    .int()
    .positive()
    .max(WAL_SEGMENT_BYTES + 1048576),
});
export const journalPartSchema = z.strictObject({
  id: z.uuid(),
  keyId: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,63}$/)
    .optional(),
  kind: z.literal("inventory"),
  name: z.literal("wal-journal.json"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z
    .number()
    .int()
    .max(2 * 1024 * 1024),
  cipherSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cipherBytes: z
    .number()
    .int()
    .max(3 * 1024 * 1024),
});
const journalSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  instanceId: z.uuid(),
  sourceSystemIdentifier: z.string().regex(/^\d{1,20}$/),
  timeline: z.number().int().positive(),
  repositoryGeneration: z.uuid(),
  keyId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  sourceAlias: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  parts: z.array(partSchema).max(4096),
  previousWindow: z
    .strictObject({
      part: journalPartSchema,
      endSegment: z.string().regex(/^[A-F0-9]{24}$/),
    })
    .optional(),
});
export type WalJournal = z.output<typeof journalSchema>;

export function validateWalJournal(input: unknown): WalJournal {
  const journal = journalSchema.parse(input);
  const segments = journal.parts.filter((p) => segmentName.test(p.name));
  if (
    new Set(journal.parts.map((p) => p.name)).size !== journal.parts.length ||
    journal.parts.some(
      (p) =>
        !(segmentName.test(p.name) || historyName.test(p.name)) ||
        (segmentName.test(p.name) &&
          (p.bytes !== WAL_SEGMENT_BYTES ||
            Number.parseInt(p.name.slice(0, 8), 16) !== journal.timeline)),
    )
  )
    throw new BackupExecutionError("wal_gap");
  assertWalSequence(segments.map((p) => p.name));
  if ((journal.version === 2) !== Boolean(journal.previousWindow))
    throw new BackupExecutionError("wal_gap");
  if (journal.previousWindow) {
    const first = segments[0],
      end = journal.previousWindow.endSegment;
    if (
      !first ||
      end.slice(0, 8) !== first.name.slice(0, 8) ||
      walOrdinal(first.name) > walOrdinal(end) + 1n ||
      walOrdinal(segments.at(-1)!.name) < walOrdinal(end)
    )
      throw new BackupExecutionError("wal_gap");
  }
  return journal;
}
