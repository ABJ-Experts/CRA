import {
  beginSyncRunInputSchema as baseStartSyncRunInputSchema,
  cancelSyncRunInputSchema,
  connectorErrorCodeSchema,
  connectorParamsSchema,
  connectorSchema as baseConnectorSchema,
  connectorTypeSchema,
  createConnectorInputSchema,
  fieldAuthorityEntityTypeSchema as mappingEntityTypeSchema,
  fieldAuthorityPolicySchema,
  fieldAuthorityPolicyValueSchema,
  externalIdentityEntityTypeSchema,
  externalIdentityMatchConfidenceSchema,
  externalIdentityMatchMethodSchema,
  linkExternalIdentityInputSchema,
  mergeExternalIdentitiesInputSchema as baseMergeExternalIdentityInputSchema,
  productExternalIdentitySchema,
  productFieldAuthorityFieldSchema,
  releaseFieldAuthorityFieldSchema,
  requestSyncRunCommitInputSchema,
  resolveSyncConflictInputSchema as baseResolveSyncConflictInputSchema,
  retrySyncRunInputSchema,
  setConnectorSecretInputSchema,
  syncConflictChosenActionSchema as conflictResolutionActionSchema,
  syncConflictEntityTypeSchema,
  syncConflictKindSchema,
  syncConflictResolutionStatusSchema as conflictResolutionStatusSchema,
  syncConflictSchema,
  syncConflictValueSourceSchema,
  syncEntityTypeSchema,
  syncProposedActionSchema as planItemProposedActionSchema,
  syncReconciliationKindSchema as reconciliationKindSchema,
  syncRunCountsSchema,
  syncRunPlanItemSchema,
  syncRunResponseSchema,
  syncRunSchema as baseSyncRunSchema,
  syncRunStatusSchema,
  syncWorkKindSchema as workKindSchema,
  unlinkExternalIdentityInputSchema,
  updateConnectorInputSchema,
  upsertFieldAuthorityPolicyInputSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  ArchiveConnectorInput,
  CancelSyncRunInput,
  ConnectorErrorCode,
  ConnectorType,
  CreateConnectorInput,
  FieldAuthorityEntityType as MappingEntityType,
  FieldAuthorityImpactPreview,
  FieldAuthorityPolicy,
  FieldAuthorityPolicyValue,
  LinkExternalIdentityInput,
  MergeExternalIdentitiesInput,
  PreviewFieldAuthorityPolicyInput,
  ProductExternalIdentity,
  RequestSyncRunCommitInput,
  ResolveSyncConflictInput,
  RetrySyncRunInput,
  SetConnectorSecretInput,
  SyncConflict,
  SyncConflictEntityType,
  SyncConflictKind,
  SyncConflictValueSource,
  SyncConflictResolutionStatus as ConflictResolutionStatus,
  SyncEntityType,
  SyncPermittedFieldAction as ConflictResolutionAction,
  SyncProposedAction as PlanItemProposedAction,
  SyncReconciliationKind as ReconciliationKind,
  SyncRunCounts,
  SyncRunPlanItem,
  SyncRunStatus,
  SyncWorkKind as WorkKind,
  UnlinkExternalIdentityInput,
  UpdateConnectorInput,
  UpsertFieldAuthorityPolicyInput,
} from "@repo/contracts/connectors/types";
import { z } from "zod";

/**
 * `packages/contracts/src/connectors/` now covers every wire schema this
 * feature needs -- everything below is either a straight re-export (kept
 * local so every screen imports from one place) or a UI-only extra:
 *  - `connectorSchema`/`Connector` adds four dashboard-only optional fields
 *    (`circuitState`, `cursorIssuedAt`, `lastCommittedAt`,
 *    `activeSyncRunStatus`) the real schema doesn't have yet -- see the note
 *    at the bottom of this file. `connectorsApi` parses responses with the
 *    real (narrower) contracts schema; these fields stay `undefined` until
 *    the backend adds them, which every call site already treats as optional.
 *  - the `*ListQuerySchema`/`*QuerySchema` schemas build query strings
 *    client-side and are not part of the wire boundary the architecture
 *    check enforces (`connectorsApi` never passes them as `schema`/
 *    `inputSchema`).
 *  - a handful of local names alias the real contracts export
 *    (`startSyncRunInputSchema` -> `beginSyncRunInputSchema`,
 *    `mergeExternalIdentityInputSchema` -> `mergeExternalIdentitiesInputSchema`)
 *    purely so existing call sites here don't need renaming.
 */

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export { connectorTypeSchema, connectorErrorCodeSchema };
export type { ConnectorType, ConnectorErrorCode };
export { updateConnectorInputSchema };
export type { UpdateConnectorInput, ArchiveConnectorInput };

/** Not part of the real `connectorSchema` -- see the reconciliation note below. */
export const circuitStateSchema = z.enum(["closed", "half_open", "open"]);
export type CircuitState = z.infer<typeof circuitStateSchema>;

export const connectorSchema = baseConnectorSchema.extend({
  // --- Backend addition needed -------------------------------------------
  // The dashboard card needs `sync_connector_cursors` freshness and the
  // latest run's status to derive "stale" / "partial-provider-outage" /
  // "syncing" / "rate-limited" badges without an N+1 fetch per card, so
  // list/get should grow these (or an explicit per-connector status field).
  // All optional so parsing degrades gracefully until the backend adds them.
  circuitState: circuitStateSchema.nullable().optional(),
  cursorIssuedAt: z.string().nullable().optional(),
  lastCommittedAt: z.string().nullable().optional(),
  activeSyncRunStatus: syncRunStatusSchema.nullable().optional(),
});
export type Connector = z.infer<typeof connectorSchema>;

export { connectorParamsSchema };

export const connectorListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    q: z.string().trim().min(1).optional(),
  })
  .strict();
export type ConnectorListQuery = z.infer<typeof connectorListQuerySchema>;

export { createConnectorInputSchema };
export type { CreateConnectorInput };

export { setConnectorSecretInputSchema };
export type { SetConnectorSecretInput };

// ---------------------------------------------------------------------------
// Field authority policy / mapping
// ---------------------------------------------------------------------------

export {
  mappingEntityTypeSchema,
  fieldAuthorityPolicyValueSchema,
  productFieldAuthorityFieldSchema,
  releaseFieldAuthorityFieldSchema,
  fieldAuthorityPolicySchema,
  upsertFieldAuthorityPolicyInputSchema,
};
export type {
  MappingEntityType,
  FieldAuthorityPolicyValue,
  FieldAuthorityPolicy,
  FieldAuthorityImpactPreview,
  UpsertFieldAuthorityPolicyInput,
  PreviewFieldAuthorityPolicyInput,
};

// ---------------------------------------------------------------------------
// Product external identity (mapping / linking)
// ---------------------------------------------------------------------------

export {
  externalIdentityEntityTypeSchema,
  externalIdentityMatchMethodSchema,
  externalIdentityMatchConfidenceSchema,
  productExternalIdentitySchema,
  linkExternalIdentityInputSchema,
};
export type { ProductExternalIdentity, LinkExternalIdentityInput };

export const identitiesQuerySchema = z
  .object({
    entityType: externalIdentityEntityTypeSchema.optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type IdentitiesQuery = z.infer<typeof identitiesQuerySchema>;

export { unlinkExternalIdentityInputSchema };
export type { UnlinkExternalIdentityInput };

/** Aliased: the real schema is `mergeExternalIdentitiesInputSchema`
 * (plural, since it merges *identities*, not one identity into itself). */
export const mergeExternalIdentityInputSchema = baseMergeExternalIdentityInputSchema;
export type MergeExternalIdentityInput = MergeExternalIdentitiesInput;

// ---------------------------------------------------------------------------
// Sync runs
// ---------------------------------------------------------------------------

export {
  reconciliationKindSchema,
  workKindSchema,
  syncRunStatusSchema,
  syncEntityTypeSchema,
  planItemProposedActionSchema,
  conflictResolutionActionSchema,
  syncRunCountsSchema,
  syncRunPlanItemSchema,
};
export type {
  ReconciliationKind,
  WorkKind,
  SyncRunStatus,
  SyncEntityType,
  PlanItemProposedAction,
  ConflictResolutionAction,
  SyncRunCounts,
  SyncRunPlanItem,
};

export const syncRunSchema = baseSyncRunSchema;
export type SyncRun = z.infer<typeof syncRunSchema>;

export { syncRunResponseSchema };
export type SyncRunResponse = z.infer<typeof syncRunResponseSchema>;

/** Local path-param check only (validates two UUID strings, never serialized). */
export const syncRunParamsSchema = z
  .object({ connectorId: z.uuid(), runId: z.uuid() })
  .strict();

export const syncRunsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type SyncRunsQuery = z.infer<typeof syncRunsQuerySchema>;

/** Aliased: the real schema is `beginSyncRunInputSchema`. */
export const startSyncRunInputSchema = baseStartSyncRunInputSchema;
export type StartSyncRunInput = z.infer<typeof startSyncRunInputSchema>;

export { requestSyncRunCommitInputSchema };
export type { RequestSyncRunCommitInput };

export { cancelSyncRunInputSchema };
export type { CancelSyncRunInput };

export { retrySyncRunInputSchema };
export type { RetrySyncRunInput };

export const planItemsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type PlanItemsQuery = z.infer<typeof planItemsQuerySchema>;

// ---------------------------------------------------------------------------
// Sync conflicts
// ---------------------------------------------------------------------------

export {
  syncConflictEntityTypeSchema,
  syncConflictKindSchema,
  syncConflictValueSourceSchema,
  conflictResolutionStatusSchema,
  syncConflictSchema,
};
export type {
  SyncConflictEntityType,
  SyncConflictKind,
  SyncConflictValueSource,
  ConflictResolutionStatus,
  SyncConflict,
};

/**
 * Local path-param check only. The controller's conflict routes are FLAT --
 * `GET/POST /connectors/conflicts/:conflictId`, no connector segment.
 */
export const conflictParamsSchema = z.object({ conflictId: z.uuid() }).strict();

export const resolveSyncConflictInputSchema = baseResolveSyncConflictInputSchema;
export type { ResolveSyncConflictInput };

/**
 * RECONCILIATION NOTE:
 *  - `packages/contracts/src/connectors/` now owns every schema this feature
 *    sends or receives over the wire; `connectors.api.ts` imports each one
 *    directly from `@repo/contracts/connectors/schemas` (and its types from
 *    `@repo/contracts/connectors/types`) rather than through this file, so
 *    the wire boundary always resolves to the shared package.
 *  - `connectorSchema` still carries four extra optional fields
 *    (`circuitState`, `cursorIssuedAt`, `lastCommittedAt`,
 *    `activeSyncRunStatus`) the real `connectorSchema` does not define --
 *    see the comment above `connectorSchema`. Because they're optional, a
 *    connector parsed with the real (narrower) schema still satisfies this
 *    richer `Connector` type; nothing here forks the wire shape.
 *  - Mapping saves include the `previewDigest` returned by the matching
 *    bounded preview. The server recomputes it under lock before persistence,
 *    so the browser cannot save a changed draft using an obsolete preview.
 *  - Conflict routes are flat (`/connectors/conflicts/:conflictId`); this
 *    file's `conflictParamsSchema` matches that, same as the contracts
 *    package's own flat `conflictParamsSchema`.
 *  - Retry and diagnostics use controller routes with shared request and
 *    response schemas. Diagnostics returns a redacted report for a local
 *    browser download, never a provider payload or signed storage URL.
 */
