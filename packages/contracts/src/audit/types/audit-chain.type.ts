import type { z } from "zod";
import type {
  auditChainRequestSchema,
  auditChainSnapshotSchema,
  auditChainRowSchema,
  auditChainResultSchema,
} from "../schemas/audit-chain.schema.js";
export type AuditChainRequest = z.output<typeof auditChainRequestSchema>;
export type AuditChainSnapshot = z.output<typeof auditChainSnapshotSchema>;
export type AuditChainRow = z.output<typeof auditChainRowSchema>;
export type AuditChainResult = z.output<typeof auditChainResultSchema>;
