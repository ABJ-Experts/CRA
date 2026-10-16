import type {
  AuditChainRow,
  AuditChainSnapshot,
} from "@repo/contracts/audit/types";
export interface AuditChainPort {
  snapshot(organizationId: string): Promise<AuditChainSnapshot>;
  page(
    organizationId: string,
    afterSequence: string,
    upperSequence: string,
    limit: number,
  ): Promise<AuditChainRow[]>;
}
