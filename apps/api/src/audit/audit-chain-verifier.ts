import { createHash } from "node:crypto";
import {
  auditChainRequestSchema,
  auditChainResultSchema,
} from "@repo/contracts/audit/schemas";
import type { AuditChainResult } from "@repo/contracts/audit/types";
import type { AuditChainPort } from "./audit-chain.port";

export const AUDIT_CHAIN_GENESIS = "0".repeat(64);
/** Verification policy: bounded streaming, no JSON number conversion and no payload output. */
export class AuditChainVerifier {
  constructor(private readonly source: AuditChainPort) {}

  async verify(input: unknown): Promise<AuditChainResult> {
    const request = auditChainRequestSchema.parse(input);
    let result: AuditChainResult = {
      organizationId: request.organizationId,
      status: "incomplete",
      reason: "read_failed",
      activationAt: null,
      legacyCount: "0",
      fromSequence: request.fromSequence,
      upperSequence: "0",
      verifiedCount: "0",
      checkpointHash: null,
      checkpointSequence: null,
      fullChain: false,
      retention: null,
      archivalRequired: true,
    };
    const finish = (
      status: AuditChainResult["status"],
      reason: AuditChainResult["reason"],
    ) => auditChainResultSchema.parse({ ...result, status, reason });
    try {
      const head = await this.source.snapshot(request.organizationId);
      if (head.organization_id !== request.organizationId)
        return finish("corrupt", "head_mismatch");
      if (head.chain_version !== 1)
        return finish("corrupt", "unsupported_version");
      const checkedAt = head.retention_checked_at
        ? Date.parse(head.retention_checked_at)
        : Number.NaN;
      const retentionFresh =
        Number.isFinite(checkedAt) &&
        checkedAt <= Date.now() &&
        Date.now() - checkedAt <= 86400000;
      result = {
        ...result,
        retention: {
          protected_through: head.protected_through,
          required_retention_days: head.required_retention_days,
          retention_status: retentionFresh ? head.retention_status : "unknown",
          retention_checked_at: head.retention_checked_at,
          legal_hold: head.legal_hold,
        },
      };
      const upper = BigInt(request.toSequence ?? head.last_sequence);
      const start = BigInt(request.fromSequence);
      result = {
        ...result,
        activationAt: head.activation_at,
        legacyCount: head.legacy_count,
        upperSequence: upper.toString(),
        fullChain: start === 1n && upper === BigInt(head.last_sequence),
      };
      if (
        upper > BigInt(head.last_sequence) ||
        (start > upper && !(start === 1n && upper === 0n))
      )
        return finish("incomplete", "range_unavailable");
      let previousHash = AUDIT_CHAIN_GENESIS;
      if (start > 1n) {
        const predecessor = await this.source.page(
          request.organizationId,
          (start - 2n).toString(),
          (start - 1n).toString(),
          1,
        );
        const prior = predecessor[0];
        if (
          predecessor.length !== 1 ||
          !prior ||
          prior.chain_sequence !== (start - 1n).toString()
        )
          return finish("corrupt", "sequence_gap");
        if (prior.chain_version !== 1)
          return finish("corrupt", "unsupported_version");
        if (prior.canonical_content !== prior.recomputed_canonical_content)
          return finish("corrupt", "canonical_mismatch");
        const predecessorHash = createHash("sha256")
          .update(Buffer.from(prior.previous_hash, "hex"))
          .update(prior.canonical_content, "utf8")
          .digest("hex");
        if (predecessorHash !== prior.content_hash)
          return finish("corrupt", "hash_mismatch");
        previousHash = predecessorHash;
      }
      let expected = start;
      let lastId: string | null = null;
      while (expected <= upper) {
        const remaining = request.maxEvents - Number(result.verifiedCount);
        if (remaining === 0) return finish("incomplete", "event_limit");
        const limit = Math.min(request.pageSize, remaining);
        const rows = await this.source.page(
          request.organizationId,
          (expected - 1n).toString(),
          upper.toString(),
          limit,
        );
        if (rows.length === 0 || rows.length > limit)
          return finish("corrupt", "sequence_gap");
        for (const row of rows) {
          if (BigInt(row.chain_sequence) !== expected || expected > upper)
            return finish("corrupt", "sequence_gap");
          if (row.chain_version !== 1)
            return finish("corrupt", "unsupported_version");
          if (row.canonical_content !== row.recomputed_canonical_content)
            return finish("corrupt", "canonical_mismatch");
          if (row.previous_hash !== previousHash)
            return finish("corrupt", "previous_hash_mismatch");
          const hash = createHash("sha256")
            .update(Buffer.from(previousHash, "hex"))
            .update(row.canonical_content, "utf8")
            .digest("hex");
          if (hash !== row.content_hash)
            return finish("corrupt", "hash_mismatch");
          previousHash = hash;
          lastId = row.id;
          expected += 1n;
          result = {
            ...result,
            verifiedCount: (BigInt(result.verifiedCount) + 1n).toString(),
            checkpointHash: hash,
            checkpointSequence: row.chain_sequence,
          };
        }
      }
      if (
        upper === BigInt(head.last_sequence) &&
        (head.last_hash !== previousHash || head.last_event_id !== lastId)
      )
        return finish("corrupt", "head_mismatch");
      if (upper === 0n)
        result = {
          ...result,
          checkpointSequence: "0",
          checkpointHash: AUDIT_CHAIN_GENESIS,
        };
      return finish("verified", null);
    } catch {
      return finish("incomplete", "read_failed");
    }
  }
}
