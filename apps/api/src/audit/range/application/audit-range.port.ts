import type {
  AuditRangeCreateInput,
  AuditRangeOperationInput,
  AuditRangeJob,
} from "@repo/contracts/audit/types";
export const AUDIT_RANGE_REPOSITORY = Symbol("AUDIT_RANGE_REPOSITORY");
export interface AuditRangeRepository {
  create(
    orgId: string,
    actorId: string,
    input: AuditRangeCreateInput,
  ): Promise<AuditRangeJob>;
  status(
    orgId: string,
    actorId: string,
    jobId: string,
    requestId: string,
  ): Promise<AuditRangeJob>;
  cancel(
    orgId: string,
    actorId: string,
    jobId: string,
    input: AuditRangeOperationInput,
  ): Promise<AuditRangeJob>;
  resume(
    orgId: string,
    actorId: string,
    jobId: string,
    input: AuditRangeOperationInput,
  ): Promise<AuditRangeJob>;
  recordDenial(
    orgId: string,
    actorId: string,
    requestId: string,
    operationDigest: string,
  ): Promise<void>;
}
