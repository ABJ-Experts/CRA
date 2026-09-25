import type { z } from "zod";

import type {
  archiveConnectorInputSchema,
  diagnosticsExportInputSchema,
  connectorAdapterVersionSchema,
  connectorCommitPolicySchema,
  connectorConnectionConfigSchema,
  connectorErrorCodeSchema,
  connectorParamsSchema,
  connectorSchema,
  connectorTestOutcomeSchema,
  connectorTypeSchema,
  createConnectorInputSchema,
  setConnectorSecretInputSchema,
  testConnectorInputSchema,
  testConnectorResultSchema,
  updateConnectorInputSchema,
} from "../schemas/index.js";

export type ConnectorType = z.output<typeof connectorTypeSchema>;
export type ConnectorAdapterVersion = z.output<
  typeof connectorAdapterVersionSchema
>;
export type ConnectorCommitPolicy = z.output<
  typeof connectorCommitPolicySchema
>;
export type ConnectorTestOutcome = z.output<typeof connectorTestOutcomeSchema>;
export type ConnectorErrorCode = z.output<typeof connectorErrorCodeSchema>;
export type ConnectorConnectionConfig = z.output<
  typeof connectorConnectionConfigSchema
>;
export type ConnectorParams = z.output<typeof connectorParamsSchema>;
export type Connector = z.output<typeof connectorSchema>;
export type CreateConnectorInput = z.output<typeof createConnectorInputSchema>;
export type UpdateConnectorInput = z.output<typeof updateConnectorInputSchema>;
export type TestConnectorResult = z.output<typeof testConnectorResultSchema>;
export type ArchiveConnectorInput = z.output<
  typeof archiveConnectorInputSchema
>;
export type DiagnosticsExportInput = z.output<
  typeof diagnosticsExportInputSchema
>;
export type SetConnectorSecretInput = z.output<
  typeof setConnectorSecretInputSchema
>;
export type TestConnectorInput = z.output<typeof testConnectorInputSchema>;
