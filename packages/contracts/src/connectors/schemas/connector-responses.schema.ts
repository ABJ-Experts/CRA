import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";
import { z } from "zod";
import { connectorSchema } from "./connector.schema.js";
import {
  fieldAuthorityImpactPreviewSchema,
  fieldAuthorityPolicySchema,
} from "./field-authority-policy.schema.js";
import { productExternalIdentitySchema } from "./external-identity.schema.js";
import { syncRunSchema, syncRunPlanItemSchema } from "./sync-run.schema.js";
import { syncConflictSchema } from "./sync-conflict.schema.js";

/** Wire envelopes for the connector-sync controller. Resource shapes live in
 * the sibling schema files; this is only the `{resource: ...}` / paged wrapping. */

export const connectorResponseSchema = z
  .object({ connector: connectorSchema })
  .strict();
export const connectorsResponseSchema = z
  .object({ connectors: pagedSchema(connectorSchema) })
  .strict();

export const fieldAuthorityPolicyResponseSchema = z
  .object({ policy: fieldAuthorityPolicySchema })
  .strict();
export const fieldAuthorityPoliciesResponseSchema = z
  .object({ policies: z.array(fieldAuthorityPolicySchema) })
  .strict();
export const fieldAuthorityImpactPreviewResponseSchema = z
  .object({ preview: fieldAuthorityImpactPreviewSchema })
  .strict();

export const productExternalIdentityResponseSchema = z
  .object({ mapping: productExternalIdentitySchema })
  .strict();
export const productExternalIdentitiesResponseSchema = z
  .object({ identities: pagedSchema(productExternalIdentitySchema) })
  .strict();

export const syncRunResponseSchema = z.object({ run: syncRunSchema }).strict();
export const syncRunsResponseSchema = z
  .object({ runs: pagedSchema(syncRunSchema) })
  .strict();
export const syncRunPlanItemsResponseSchema = z
  .object({ planItems: pagedSchema(syncRunPlanItemSchema) })
  .strict();

export const syncConflictResponseSchema = z
  .object({ conflict: syncConflictSchema })
  .strict();
export const syncConflictsResponseSchema = z
  .object({ conflicts: z.array(syncConflictSchema) })
  .strict();

export const connectorMetricsSnapshotSchema = z
  .object({
    connectorCount: z.number().int().nonnegative(),
    connectorDeadLetterCount: z.number().int().nonnegative(),
    connectorOpenConflictCount: z.number().int().nonnegative(),
    connectorRetryCount: z.number().int().nonnegative(),
    connectorStaleCount: z.number().int().nonnegative(),
    connectorCircuitOpenCount: z.number().int().nonnegative(),
  })
  .strict();
export const connectorMetricsSnapshotResponseSchema = z
  .object({ metrics: connectorMetricsSnapshotSchema })
  .strict();

/** `{outcome}` acknowledgement for mutations that don't return a full resource. */
export const connectorOutcomeResponseSchema = z
  .object({ outcome: z.string() })
  .strict();

/** Deliberately small and redacted. The UI serializes this value to a Blob;
 * connector secrets, provider payloads, and signed storage URLs never cross
 * the server/browser boundary. */
export const connectorDiagnosticsReportSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    connectorId: z.uuid(),
    connectorStatus: z.enum([
      "disconnected",
      "testing",
      "unauthorized",
      "mapping_incomplete",
      "dry_run",
      "conflicts_present",
      "waiting_for_review",
      "syncing",
      "stale",
      "rate_limited",
      "retrying",
      "partial_provider_outage",
      "failed",
      "canceled",
      "completed",
    ]),
    cursorAgeSeconds: z.number().int().nonnegative().nullable(),
    latestRun: z
      .object({
        id: z.uuid(),
        status: z.string(),
        errorCode: z.string().nullable(),
        completedAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strict()
      .nullable(),
    counts: z
      .object({
        openConflicts: z.number().int().nonnegative(),
        deadLetters: z.number().int().nonnegative(),
        retries: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const diagnosticsExportResponseSchema = z
  .object({
    filename: z.string().regex(/^connector-diagnostic-[a-z0-9-]+\.json$/),
    report: connectorDiagnosticsReportSchema,
  })
  .strict();
