import {
  auditChainPageSchema,
  auditChainSnapshotSchema,
  auditSequenceSchema,
} from "@repo/contracts/audit/schemas";
import type {
  AuditChainRow,
  AuditChainSnapshot,
} from "@repo/contracts/audit/types";
import { z } from "zod";
import type { AuditChainPort } from "./audit-chain.port";

/** Narrow transport keeps the operator independent of Nest's HTTP/background workers. */
export interface AuditChainRpcClient {
  rpc(
    name: string,
    args: Record<string, string | number>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export class SupabaseAuditChainAdapter implements AuditChainPort {
  constructor(private readonly client: AuditChainRpcClient) {}

  async snapshot(organizationId: string): Promise<AuditChainSnapshot> {
    const id = z.uuid().parse(organizationId);
    const { data, error } = await this.client.rpc(
      "m13_02_audit_chain_snapshot",
      { p_organization_id: id },
    );
    if (error) throw new Error("Audit chain snapshot unavailable");
    const head = auditChainSnapshotSchema.parse(data);
    if (head.organization_id !== id)
      throw new Error("Audit chain tenant mismatch");
    return head;
  }

  async page(
    organizationId: string,
    afterSequence: string,
    upperSequence: string,
    limit: number,
  ): Promise<AuditChainRow[]> {
    const id = z.uuid().parse(organizationId);
    const after = auditSequenceSchema.parse(afterSequence);
    const upper = auditSequenceSchema.parse(upperSequence);
    const size = z.number().int().min(1).max(1000).parse(limit);
    if (BigInt(after) > BigInt(upper))
      throw new Error("Invalid audit page range");
    const { data, error } = await this.client.rpc("m13_02_audit_chain_page", {
      p_organization_id: id,
      p_after_sequence: after,
      p_upper_sequence: upper,
      p_limit: size,
    });
    if (error) throw new Error("Audit chain page unavailable");
    const rows = auditChainPageSchema.parse(data);
    if (rows.length > size)
      throw new Error("Audit page exceeds requested bound");
    return rows;
  }
}
