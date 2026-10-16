import type { z } from "zod";
import type * as schemas from "../schemas/sync-operations.schema.js";
export type ConnectorFieldMapping = z.output<
  typeof schemas.connectorFieldMappingSchema
>;
export type ConnectorFieldMap = z.output<
  typeof schemas.connectorFieldMapSchema
>;
export type ConnectorMappingDiscovery = z.output<
  typeof schemas.connectorMappingDiscoverySchema
>;
export type ConnectorCapabilitiesContract = z.output<
  typeof schemas.connectorCapabilitiesSchema
>;
export type ConnectorMappingIssue = z.output<
  typeof schemas.connectorMappingIssueSchema
>;
export type ConnectorMappingPreview = z.output<
  typeof schemas.connectorMappingPreviewSchema
>;
export type PreviewConnectorFieldMappingInput = z.output<
  typeof schemas.previewConnectorFieldMappingInputSchema
>;
export type SaveConnectorFieldMappingInput = z.output<
  typeof schemas.saveConnectorFieldMappingInputSchema
>;
export type SyncHistoryQuery = z.output<typeof schemas.syncHistoryQuerySchema>;
export type SyncRunHistory = z.output<typeof schemas.syncRunHistorySchema>;
export type SyncRunAttempt = z.output<typeof schemas.syncRunAttemptSchema>;
export type SyncRecordOutcome = z.output<
  typeof schemas.syncRecordOutcomeSchema
>;
export type SyncRunDetail = z.output<
  typeof schemas.syncRunDetailResponseSchema
>;
export type ReplaySyncRunPreviewInput = z.output<
  typeof schemas.replaySyncRunPreviewInputSchema
>;
export type ReplaySyncRunPreview = z.output<
  typeof schemas.replaySyncRunPreviewSchema
>;
export type ReplaySyncRunInput = z.output<
  typeof schemas.replaySyncRunInputSchema
>;
export type SyncFailureCategory = z.output<
  typeof schemas.syncFailureCategorySchema
>;
