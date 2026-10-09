import { z } from "zod";
import {
  connectorCapabilitiesSchema,
  connectorPullPageSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  ConnectorCapabilities,
  ConnectorConnectionConfig,
  ConnectorPort,
  ConnectorTestResult,
  PullPage,
  PushRecord,
  PushResult,
  SyncCursor,
} from "../application/connector-port";

type StagingReader = Readonly<{
  agentCapabilities(
    orgId: string,
    connectorId: string,
  ): Promise<ConnectorCapabilities | null>;
  pullStagedPage(
    orgId: string,
    connectorId: string,
    cursor: SyncCursor | null,
    pageSize: number,
  ): Promise<PullPage>;
}>;

/** Reads durable agent submissions through the ordinary reviewed sync boundary. */
export class AgentBackedAdapter implements ConnectorPort {
  readonly connectorType = "on_prem_agent" as const;
  readonly adapterVersion = "1.0.0";
  readonly mappingVersion = "on-prem-agent-v1";

  constructor(private readonly staging: StagingReader) {}

  async testConnection(
    config: ConnectorConnectionConfig,
  ): Promise<ConnectorTestResult> {
    const [orgId, connectorId] = scope(config);
    const capabilities = await this.staging.agentCapabilities(
      orgId,
      connectorId,
    );
    if (!capabilities)
      return {
        outcome: "failure",
        errorCode: "unreachable",
        message: "The enrolled agent is unavailable.",
      };
    connectorCapabilitiesSchema.parse(capabilities);
    return {
      outcome: "success",
      adapterVersion: this.adapterVersion,
      latencyMs: 0,
    };
  }

  async discoverCapabilities(
    config: ConnectorConnectionConfig,
  ): Promise<ConnectorCapabilities> {
    const [orgId, connectorId] = scope(config);
    const capabilities = await this.staging.agentCapabilities(
      orgId,
      connectorId,
    );
    if (!capabilities) throw new Error("Agent capabilities unavailable");
    return connectorCapabilitiesSchema.parse(capabilities);
  }

  async pull(
    config: ConnectorConnectionConfig,
    cursor: SyncCursor | null,
    pageSize: number,
  ): Promise<PullPage> {
    const [orgId, connectorId] = scope(config);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)
      throw new Error("Invalid agent page size");
    return connectorPullPageSchema.parse(
      await this.staging.pullStagedPage(orgId, connectorId, cursor, pageSize),
    );
  }

  push(
    config: ConnectorConnectionConfig,
    records: readonly PushRecord[],
  ): Promise<readonly PushResult[]> {
    scope(config);
    return Promise.resolve(
      records.map(() => ({
        outcome: "rejected" as const,
        errorCode: "unsupported_capability" as const,
        message: "This agent does not write to internal systems.",
      })),
    );
  }
}

function scope(config: ConnectorConnectionConfig): readonly [string, string] {
  if (config.connectorType !== "on_prem_agent")
    throw new Error("Wrong connector type");
  return [
    z.uuid().parse(config.organizationId),
    z.uuid().parse(config.connectorId),
  ];
}
