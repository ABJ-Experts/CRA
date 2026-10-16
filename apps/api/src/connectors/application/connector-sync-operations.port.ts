import type { Paged } from "@repo/contracts/pagination";
import type {
  ConnectorFieldMap,
  SaveConnectorFieldMappingInput,
  SyncHistoryQuery,
  SyncRunHistory,
  SyncRunDetail,
  SyncRecordOutcome,
  ReplaySyncRunPreviewInput,
  ReplaySyncRunPreview,
  ReplaySyncRunInput,
  SyncRun,
} from "@repo/contracts/connectors/types";
import type { ConnectorAuthorization } from "./connector-authorization.port";
import type { ConnectorRequestFingerprint } from "./connector-vault.port";
export interface ConnectorSyncOperationsRepository {
  currentMapping(
    orgId: string,
    connectorId: string,
  ): Promise<ConnectorFieldMap>;
  saveMapping(
    orgId: string,
    connectorId: string,
    authorization: ConnectorAuthorization,
    input: SaveConnectorFieldMappingInput,
    fingerprint: ConnectorRequestFingerprint,
  ): Promise<ConnectorFieldMap>;
  history(
    orgId: string,
    connectorId: string,
    query: SyncHistoryQuery,
  ): Promise<Paged<SyncRunHistory>>;
  detail(
    orgId: string,
    connectorId: string,
    runId: string,
    query: SyncHistoryQuery,
  ): Promise<SyncRunDetail>;
  deadLetters(
    orgId: string,
    connectorId: string,
    query: SyncHistoryQuery,
  ): Promise<Paged<SyncRecordOutcome>>;
  replayPreview(
    orgId: string,
    connectorId: string,
    runId: string,
    authorization: ConnectorAuthorization,
    input: ReplaySyncRunPreviewInput,
  ): Promise<ReplaySyncRunPreview>;
  replay(
    orgId: string,
    connectorId: string,
    runId: string,
    authorization: ConnectorAuthorization,
    input: ReplaySyncRunInput,
    fingerprint: ConnectorRequestFingerprint,
  ): Promise<SyncRun>;
}
