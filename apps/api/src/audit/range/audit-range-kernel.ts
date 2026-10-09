import { auditRangeResultSchema } from "@repo/contracts/audit/schemas";
import type {
  AuditChainRow,
  AuditRangeResult,
} from "@repo/contracts/audit/types";
import { auditRowFailures } from "../audit-chain-row-verification";
import type {
  AuditRangeCursor,
  AuditRangeWorkerJob,
} from "./audit-range-worker.port";
type Bounds = Pick<
  AuditRangeWorkerJob,
  "fromSequence" | "toSequence" | "head" | "predecessor" | "boundary"
>;
type Category = AuditRangeResult["breaks"][number]["category"];
const genesis = "0".repeat(64);
function addBreak(
  state: AuditRangeCursor,
  category: Category,
  from: string,
  to = from,
): AuditRangeCursor {
  if (state.breaks.length >= 100) return state;
  const samples = [...state.sampleSequences];
  if (samples.length < 100 && !samples.includes(from)) samples.push(from);
  return {
    ...state,
    verifiedPrefixTo: state.verifiedPrefixTo,
    breaks: [...state.breaks, { category, fromSequence: from, toSequence: to }],
    sampleSequences: samples,
  };
}
export function initializeAuditRange(job: Bounds): AuditRangeCursor {
  let state: AuditRangeCursor = {
    nextSequence: job.fromSequence,
    previousHash: genesis,
    lastEventId: null,
    checkedCount: "0",
    checkedFrom: null,
    checkedTo: null,
    verifiedPrefixTo: null,
    breaks: [],
    sampleSequences: [],
    exhausted: false,
  };
  if (
    job.head?.chainVersion !== undefined &&
    job.head.chainVersion !== 1 &&
    job.toSequence !== "0"
  )
    state = addBreak(state, "unsupported_version", job.fromSequence);
  if (BigInt(job.fromSequence) > 1n) {
    const prior = job.predecessor;
    if (
      !prior ||
      BigInt(prior.chain_sequence) !== BigInt(job.fromSequence) - 1n ||
      auditRowFailures(prior).length > 0
    )
      state = addBreak(state, "predecessor_failure", job.fromSequence);
    if (prior) state = { ...state, previousHash: prior.content_hash };
  }
  return state;
}
/** Continue checking self hashes after a break using recorded hashes to avoid cascaded false positives. */
export function inspectAuditRangeBatch(
  job: Bounds,
  initial: AuditRangeCursor,
  rows: readonly AuditChainRow[],
  exhausted: boolean,
): AuditRangeCursor {
  let state = initial;
  for (const row of rows) {
    if (state.breaks.length >= 100) break;
    const sequence = BigInt(row.chain_sequence),
      expected = BigInt(state.nextSequence);
    if (sequence < BigInt(job.fromSequence)) {
      state = addBreak(state, "frozen_boundary_mismatch", job.fromSequence);
      continue;
    }
    if (sequence < expected) {
      state = addBreak(
        state,
        sequence === expected - 1n ? "duplicate_sequence" : "reordered_rows",
        row.chain_sequence,
      );
      continue;
    }
    if (sequence > BigInt(job.toSequence)) {
      state = addBreak(state, "frozen_boundary_mismatch", job.toSequence);
      break;
    }
    const contiguous = sequence === expected;
    if (!contiguous)
      state = addBreak(
        state,
        "missing_sequence_interval",
        expected.toString(),
        (sequence - 1n).toString(),
      );
    const before = state.breaks.length;
    for (const failure of auditRowFailures(row))
      state = addBreak(state, failure, row.chain_sequence);
    if (contiguous && row.previous_hash !== state.previousHash)
      state = addBreak(state, "previous_link_mismatch", row.chain_sequence);
    const prefixUnbroken = state.breaks.length === 0 && before === 0;
    state = {
      ...state,
      nextSequence: (sequence + 1n).toString(),
      previousHash: row.content_hash,
      lastEventId: row.id,
      checkedCount: (BigInt(state.checkedCount) + 1n).toString(),
      checkedFrom: state.checkedFrom ?? row.chain_sequence,
      checkedTo: row.chain_sequence,
      verifiedPrefixTo: prefixUnbroken
        ? row.chain_sequence
        : state.verifiedPrefixTo,
    };
  }
  if (exhausted && BigInt(state.nextSequence) <= BigInt(job.toSequence))
    state = addBreak(
      state,
      "missing_sequence_interval",
      state.nextSequence,
      job.toSequence,
    );
  const reached = BigInt(state.nextSequence) > BigInt(job.toSequence);
  if (
    reached &&
    job.boundary &&
    (state.previousHash !== job.boundary.hash ||
      state.lastEventId !== job.boundary.eventId ||
      job.toSequence !== job.boundary.sequence)
  )
    state = addBreak(state, "frozen_boundary_mismatch", job.toSequence);
  if (job.head && BigInt(job.toSequence) > BigInt(job.head.sequence)) {
    const firstBeyondHead = BigInt(job.head.sequence) + 1n;
    const affected =
      firstBeyondHead < BigInt(job.fromSequence)
        ? job.fromSequence
        : firstBeyondHead.toString();
    if (!state.breaks.some((item) => item.category === "head_mismatch"))
      state = addBreak(state, "head_mismatch", affected, job.toSequence);
  }
  if (
    reached &&
    job.toSequence !== "0" &&
    job.head &&
    job.toSequence === job.head.sequence &&
    (state.previousHash !== job.head.hash ||
      state.lastEventId !== job.head.eventId)
  )
    state = addBreak(state, "head_mismatch", job.toSequence);
  return { ...state, exhausted: exhausted || reached };
}
export function auditRangeResult(
  job: Pick<
    AuditRangeWorkerJob,
    | "fromSequence"
    | "toSequence"
    | "head"
    | "datasetContext"
    | "legacyCount"
    | "priorCheckpointStatus"
    | "requestedToSequence"
  > &
    Partial<Pick<AuditRangeWorkerJob, "priorCheckpoint">>,
  state: AuditRangeCursor,
  now: Date,
): AuditRangeResult {
  const empty = job.toSequence === "0";
  if (job.priorCheckpointStatus === "mismatch")
    state = addBreak(
      state,
      "prior_checkpoint_mismatch",
      job.priorCheckpoint?.sequence ?? job.fromSequence,
    );
  const inspectionComplete = state.exhausted && state.breaks.length < 100;
  const checkpointUnavailable =
    (!empty && job.head === null) ||
    (empty &&
      job.head !== null &&
      (job.head.hash !== genesis ||
        job.head.eventId !== null ||
        (job.head.chainVersion !== undefined &&
          job.head.chainVersion !== 1))) ||
    ["ahead", "unavailable"].includes(job.priorCheckpointStatus);
  const outcome = checkpointUnavailable
    ? "checkpoint_unavailable"
    : empty
      ? job.legacyCount !== "0"
        ? "legacy_unchained"
        : "empty"
      : !inspectionComplete
        ? "incomplete"
        : state.breaks.length
          ? "integrity_break"
          : "consistent";
  return auditRangeResultSchema.parse({
    outcome,
    algorithm: "sha256",
    chainVersion: 1,
    requestedRange: {
      from: job.fromSequence,
      to:
        job.requestedToSequence === undefined
          ? empty
            ? null
            : job.toSequence
          : job.requestedToSequence,
    },
    frozenRange: empty ? null : { from: job.fromSequence, to: job.toSequence },
    checkedRange:
      state.checkedFrom && state.checkedTo
        ? { from: state.checkedFrom, to: state.checkedTo }
        : null,
    verifiedPrefix: state.verifiedPrefixTo
      ? { from: job.fromSequence, to: state.verifiedPrefixTo }
      : null,
    checkedCount: state.checkedCount,
    firstAffectedSequence: state.breaks.reduce<string | null>(
      (first, item) =>
        first === null || BigInt(item.fromSequence) < BigInt(first)
          ? item.fromSequence
          : first,
      null,
    ),
    breaks: state.breaks,
    sampleSequences: state.sampleSequences,
    inspectionComplete,
    checkedAt: now.toISOString(),
    datasetContext: job.datasetContext,
    priorCheckpointStatus: job.priorCheckpointStatus,
    authenticityProven: false,
    completeLedgerVerified: false,
  });
}
