import { z } from "zod";
import { supplierListQuerySchema } from "../../suppliers/schemas/supplier-registry.schema.js";
import * as supplierEvidence from "../../supplier-evidence/schemas/index.js";
import {
  definition,
  portalDefinition,
  textColumns,
  none,
} from "./export-source-base.schema.js";

export const suppliersExportSources = {
  "suppliers.registry": definition(
    supplierListQuerySchema,
    none,
    textColumns("id", "name", "criticality", "state", "createdAt"),
    [
      "can_view_suppliers",
      "can_view_products",
      "can_view_sboms",
      "can_export_suppliers",
    ],
  ),
  "suppliers.contacts": definition(
    none,
    z.object({ supplierId: z.uuid() }).strict(),
    textColumns("id", "name", "email", "state", "role", "createdAt"),
    ["can_view_suppliers", "can_export_suppliers"],
  ),
  "suppliers.responsibilities": definition(
    none,
    z.object({ supplierId: z.uuid() }).strict(),
    textColumns(
      "id",
      "productId",
      "releaseId",
      "componentIdentity",
      "componentVersion",
      "state",
      "provenance",
      "createdAt",
    ),
    ["can_view_suppliers", "can_export_suppliers"],
  ),
  "supplier_evidence.requests": definition(
    supplierEvidence.supplierEvidenceRequestListQuerySchema,
    none,
    textColumns("id", "status", "title", "createdAt", "updatedAt"),
    ["can_view_suppliers", "can_export_suppliers"],
  ),
  "supplier_evidence.overdue": definition(
    supplierEvidence.supplierEvidenceOverdueListQuerySchema,
    none,
    textColumns("id", "title", "dueAt", "status"),
    ["can_view_suppliers", "can_export_suppliers"],
  ),
  "supplier_evidence.review_items": definition(
    none,
    z.object({ requestId: z.uuid() }).strict(),
    textColumns(
      "id",
      "title",
      "documentClass",
      "kind",
      "position",
      "state",
      "reRequestReason",
    ),
    ["can_view_suppliers", "can_export_suppliers"],
  ),
  "supplier_evidence.review_submissions": definition(
    none,
    z.object({ requestId: z.uuid(), checklistItemId: z.uuid() }).strict(),
    textColumns(
      "id",
      "checklistItemId",
      "state",
      "fileName",
      "mediaType",
      "byteSize",
      "evidenceProcessingState",
      "processingState",
      "reviewState",
      "rejectionReason",
      "createdAt",
    ),
    ["can_view_suppliers", "can_export_suppliers"],
  ),
  "supplier_evidence.review_history": definition(
    none,
    z.object({ requestId: z.uuid(), submissionId: z.uuid() }).strict(),
    textColumns(
      "id",
      "submissionId",
      "decision",
      "supplierVisibleReason",
      "reviewedAt",
      "createdAt",
    ),
    ["can_view_suppliers", "can_export_suppliers"],
  ),
  "supplier_evidence.extraction_fields": definition(
    supplierEvidence.supplierDocumentExtractionQuerySchema,
    z
      .object({
        productId: z.uuid(),
        requestId: z.uuid(),
        submissionId: z.uuid(),
      })
      .strict(),
    textColumns(
      "id",
      "fieldKey",
      "originalValue",
      "correctedValue",
      "confidence",
      "status",
    ),
    ["can_view_suppliers", "can_export_suppliers"],
  ),
  "supplier_evidence.portal_items": portalDefinition(
    none,
    none,
    textColumns(
      "id",
      "title",
      "instructions",
      "documentClass",
      "kind",
      "position",
      "reRequestReason",
    ),
    "supplier_session",
  ),
  "supplier_evidence.portal_submissions": portalDefinition(
    none,
    z.object({ checklistItemId: z.uuid() }).strict(),
    textColumns(
      "id",
      "checklistItemId",
      "state",
      "fileName",
      "mediaType",
      "byteSize",
      "rejectionReason",
      "createdAt",
      "updatedAt",
    ),
    "supplier_session",
  ),
} as const;
