import type {
  AuditChainRow,
  AuditRangeResult,
} from "@repo/contracts/audit/types";
export type AuditRangeCursor = Readonly<{
  nextSequence: string;
  previousHash: string;
  lastEventId: string | null;
  checkedCount: string;
  checkedFrom: string | null;
  checkedTo: string | null;
  verifiedPrefixTo: string | null;
  breaks: AuditRangeResult["breaks"];
  sampleSequences: readonly string[];
  exhausted: boolean;
}>;
export type AuditRangeAnchor = Readonly<{
  sequence: string;
  hash: string;
  eventId: string | null;
  chainVersion?: number;
}>;
export type AuditRangeWorkerJob = Readonly<{
  id: string;
  organizationId: string;
  version: number;
  leaseToken: string;
  workerId: string;
  phase: "authorization" | "verification";
  fromSequence: string;
  toSequence: string;
  requestedToSequence?: string | null;
  head: AuditRangeAnchor | null;
  boundary?: AuditRangeAnchor | null;
  predecessor: AuditChainRow | null;
  cursor: AuditRangeCursor | null;
  datasetContext: AuditRangeResult["datasetContext"];
  legacyCount: string;
  priorCheckpoint: AuditRangeAnchor | null;
  priorCheckpointStatus: AuditRangeResult["priorCheckpointStatus"];
}>;
export interface AuditRangeWorkerPort {
  claim(workerId: string): Promise<AuditRangeWorkerJob | null>;
  authorizeBatch(
    job: AuditRangeWorkerJob,
    limit: number,
    maximumBytes: number,
  ): Promise<
    Readonly<{
      job: AuditRangeWorkerJob;
      complete: boolean;
      scopeAvailable: boolean;
    }>
  >;
  revalidate(job: AuditRangeWorkerJob): Promise<
    Readonly<{
      job: AuditRangeWorkerJob;
      anchorsValid: boolean;
      scopeAvailable: boolean;
    }>
  >;
  page(
    job: AuditRangeWorkerJob,
    afterSequence: string,
    upperSequence: string,
    limit: number,
    maximumBytes: number,
  ): Promise<Readonly<{ rows: readonly AuditChainRow[]; exhausted: boolean }>>;
  checkpoint(
    job: AuditRangeWorkerJob,
    cursor: AuditRangeCursor | null,
    result: AuditRangeResult | null,
  ): Promise<void>;
  finishUnavailable(
    job: AuditRangeWorkerJob,
    outcome: "scope_unavailable" | "checkpoint_unavailable",
  ): Promise<void>;
  fail(
    job: AuditRangeWorkerJob,
    code:
      | "provider_unavailable"
      | "malformed_provider"
      | "event_limit"
      | "byte_limit",
    retryable: boolean,
  ): Promise<void>;
}
