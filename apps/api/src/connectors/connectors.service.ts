import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { TooManyRequestsException } from "../common/exceptions/too-many-requests.exception";
import type {
  ConnectorConnectionConfig,
  ConnectorPort,
  ConnectorType,
} from "./application/connector-port";
import {
  ConnectorError,
  type ConnectorErrorCode,
} from "./application/connector-errors";
import { SupabaseConnectorRepository } from "./infrastructure/supabase-connector.repository";

/** Result -> HttpException mapping, mirroring ProductComplianceService. */
@Injectable()
export class ConnectorsService {
  constructor(
    readonly repository: SupabaseConnectorRepository,
    private readonly adapters: ReadonlyMap<
      ConnectorType,
      ConnectorPort
    > = new Map(),
    private readonly connectorSecretEncryptionKey = process.env
      .CONNECTOR_SECRET_ENCRYPTION_KEY ?? "",
  ) {}

  /**
   * Resolve a connector secret only inside the API process, pass it directly
   * to the inward-owned port, then persist the bounded result. Neither the
   * provider message nor secret reaches a controller response, audit fact,
   * queue payload, or logger.
   */
  async testConnection(
    input: Readonly<{
      organizationId: string;
      connectorId: string;
      actorId: string;
    }>,
  ) {
    const connector = (await this.repository.getConnector(
      input.organizationId,
      input.connectorId,
    )) as Readonly<Record<string, unknown>>;
    const connectorType = connector.connectorType as ConnectorType;
    const adapter = this.adapters.get(connectorType);
    if (!adapter) throw new ConnectorError("unavailable");

    const secretValue =
      connector.hasSecret === true && this.connectorSecretEncryptionKey !== ""
        ? await this.repository.resolveConnectorSecret(
            input.organizationId,
            input.connectorId,
            this.connectorSecretEncryptionKey,
          )
        : null;
    const result = await adapter.testConnection(
      toConnectorConnectionConfig(connector, secretValue),
    );

    return this.repository.testConnector(
      input.organizationId,
      input.connectorId,
      input.actorId,
      result.outcome,
      result.outcome === "failure" ? result.errorCode : null,
      result.outcome === "success" ? result.latencyMs : 0,
    );
  }

  async run<T>(pending: Promise<T>): Promise<T> {
    try {
      return await pending;
    } catch (error) {
      if (error instanceof ConnectorError) throw this.httpFailure(error.code);
      throw error;
    }
  }

  private httpFailure(code: ConnectorErrorCode): Error {
    const message = "Connector request could not be completed.";
    switch (code) {
      case "invalid_request":
        return new BadRequestException({ message, code });
      case "not_found":
        return new NotFoundException({ message, code });
      case "conflict":
      case "invalid_state":
      case "already_running":
      case "stale_preview":
      case "blocked_by_conflicts":
      case "idempotency_mismatch":
        return new ConflictException({ message, code });
      case "dry_run_expired":
        return new GoneException({ message, code });
      case "forbidden_by_policy":
        return new ForbiddenException({ message, code });
      case "rate_limited":
        return new TooManyRequestsException({ message, code });
      case "retryable_unavailable":
      case "unavailable":
        return new ServiceUnavailableException({ message, code });
      case "payload_too_large":
        return new BadRequestException({ message, code });
      case "unsupported_content_type":
        return new BadRequestException({ message, code });
    }
  }
}

function toConnectorConnectionConfig(
  connector: Readonly<Record<string, unknown>>,
  secretValue: string | null,
): ConnectorConnectionConfig {
  const connectionConfig =
    connector.connectionConfig !== null &&
    typeof connector.connectionConfig === "object" &&
    !Array.isArray(connector.connectionConfig)
      ? (connector.connectionConfig as Readonly<Record<string, unknown>>)
      : {};
  const scopeFilter =
    connectionConfig.scopeFilter !== null &&
    typeof connectionConfig.scopeFilter === "object" &&
    !Array.isArray(connectionConfig.scopeFilter)
      ? Object.fromEntries(
          Object.entries(connectionConfig.scopeFilter).flatMap(
            ([key, value]) => (typeof value === "string" ? [[key, value]] : []),
          ),
        )
      : undefined;

  return {
    connectorType: connector.connectorType as ConnectorType,
    ...(typeof connectionConfig.baseUrl === "string"
      ? { baseUrl: connectionConfig.baseUrl }
      : {}),
    ...(typeof connectionConfig.tenantOrSiteId === "string"
      ? { tenantOrSiteId: connectionConfig.tenantOrSiteId }
      : {}),
    ...(scopeFilter ? { scopeFilter } : {}),
    secretReference: {
      provider: "reference_fixture",
      reference: secretValue ?? "",
    },
  };
}
