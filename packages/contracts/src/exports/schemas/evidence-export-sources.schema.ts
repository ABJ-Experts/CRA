import { z } from "zod";
import { evidenceDocumentListQuerySchema } from "../../evidence/schemas/evidence.schema.js";
import * as evidence from "../../evidence/schemas/index.js";
import {
  definition,
  textColumns,
  none,
  product,
  document,
} from "./export-source-base.schema.js";

export const evidenceExportSources = {
  "evidence.documents": definition(
    evidenceDocumentListQuerySchema,
    product,
    textColumns(
      "id",
      "title",
      "documentClass",
      "status",
      "validityStatus",
      "validFrom",
      "validUntil",
      "createdAt",
    ),
    ["can_view_evidence", "can_export_evidence"],
  ),
  "evidence.search_results": definition(
    evidence.evidenceSearchQuerySchema,
    product,
    textColumns(
      "documentId",
      "versionId",
      "title",
      "documentClass",
      "createdAt",
      "validUntil",
      "currentVersion",
      "score",
      "fileName",
      "snippet",
      "versionNumber",
    ),
    ["can_view_evidence", "can_export_evidence"],
  ),
  "evidence.versions": definition(
    none,
    z.object({ productId: z.uuid(), documentId: z.uuid() }).strict(),
    textColumns(
      "id",
      "versionNumber",
      "title",
      "documentClass",
      "status",
      "validFrom",
      "validUntil",
      "createdAt",
    ),
    ["can_view_evidence", "can_export_evidence"],
  ),
  "evidence.legal_holds": definition(
    none,
    document,
    textColumns("id", "reason", "status", "placedAt", "releasedAt"),
    ["can_view_evidence", "can_export_evidence"],
  ),
  "evidence.retention_review": definition(
    none,
    document,
    textColumns(
      "code",
      "kind",
      "productId",
      "productName",
      "retentionUntil",
      "retentionProtectionUntil",
      "message",
    ),
    ["can_view_evidence", "can_export_evidence"],
  ),
  "evidence.bulk_intake_batch": definition(
    none,
    z.object({ productId: z.uuid(), batchId: z.uuid() }).strict(),
    textColumns("id", "status", "fileName", "errorCode", "createdAt"),
    ["can_view_evidence", "can_export_evidence"],
  ),
} as const;
