import { createHash } from "node:crypto";
import type { AuditChainRow } from "@repo/contracts/audit/types";
export type AuditRowFailure =
  "unsupported_version" | "canonical_mismatch" | "hash_mismatch";
/** Hash stored canonical UTF-8 bytes; never parse/reserialize JSON numeric content. */
export function auditCanonicalHash(
  previousHash: string,
  canonicalContent: string,
): string {
  return createHash("sha256")
    .update(Buffer.from(previousHash, "hex"))
    .update(canonicalContent, "utf8")
    .digest("hex");
}
export function auditRowFailures(
  row: AuditChainRow,
): readonly AuditRowFailure[] {
  return [
    ...(row.chain_version !== 1 ? ["unsupported_version" as const] : []),
    ...(row.canonical_content !== row.recomputed_canonical_content
      ? ["canonical_mismatch" as const]
      : []),
    ...(auditCanonicalHash(row.previous_hash, row.canonical_content) !==
    row.content_hash
      ? ["hash_mismatch" as const]
      : []),
  ];
}
