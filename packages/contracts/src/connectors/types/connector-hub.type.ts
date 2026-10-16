import type { z } from "zod";
import type {
  connectorCatalogueEntrySchema,
  connectorCatalogueResponseSchema,
  connectorScopeDiagnosticsSchema,
  connectorTestDiagnosticSchema,
  connectorConnectionStateSchema,
  connectorOverviewSchema,
  connectorOverviewResponseSchema,
  connectorOverviewsResponseSchema,
  revokeConnectorSecretInputSchema,
  disconnectConnectorInputSchema,
  reconnectConnectorInputSchema,
} from "../schemas/index.js";

export type ConnectorCatalogueEntry = z.output<
  typeof connectorCatalogueEntrySchema
>;
export type ConnectorCatalogueResponse = z.output<
  typeof connectorCatalogueResponseSchema
>;
export type ConnectorScopeDiagnostics = z.output<
  typeof connectorScopeDiagnosticsSchema
>;
export type ConnectorTestDiagnostic = z.output<
  typeof connectorTestDiagnosticSchema
>;
export type ConnectorConnectionState = z.output<
  typeof connectorConnectionStateSchema
>;
export type ConnectorOverview = z.output<typeof connectorOverviewSchema>;
export type ConnectorOverviewResponse = z.output<
  typeof connectorOverviewResponseSchema
>;
export type ConnectorOverviewsResponse = z.output<
  typeof connectorOverviewsResponseSchema
>;
export type RevokeConnectorSecretInput = z.output<
  typeof revokeConnectorSecretInputSchema
>;
export type DisconnectConnectorInput = z.output<
  typeof disconnectConnectorInputSchema
>;
export type ReconnectConnectorInput = z.output<
  typeof reconnectConnectorInputSchema
>;
