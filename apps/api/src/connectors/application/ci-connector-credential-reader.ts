import {
  azureDevopsConnectorConfigurationSchema,
  githubActionsConnectorConfigurationSchema,
  gitlabCiConnectorConfigurationSchema,
} from "@repo/contracts/connectors/schemas";
import type { z } from "zod";
import { ConnectorError } from "./connector-errors";
import type {
  ConnectorEgressPolicy,
  ConnectorHubRepository,
} from "./connector-hub-repository.port";
import type { ConnectorCredentialReaderPort } from "./connector-vault.port";

type BaseConnection = Readonly<{
  connectorId: string;
  secret: string;
  credentialRevision: number;
  connectionRevision: number;
}>;

export type CiConnectorConnection = BaseConnection &
  (
    | Readonly<{
        provider: "github_actions";
        config: z.output<typeof githubActionsConnectorConfigurationSchema>;
      }>
    | Readonly<{
        provider: "gitlab_ci";
        config: z.output<typeof gitlabCiConnectorConfigurationSchema>;
      }>
    | Readonly<{
        provider: "azure_devops";
        config: z.output<typeof azureDevopsConnectorConfigurationSchema>;
      }>
  );

/** Server-only, org-scoped credential seam for the CI adapters. */
export class CiConnectorCredentialReader {
  constructor(
    private readonly repository: Pick<ConnectorHubRepository, "context">,
    private readonly reader: ConnectorCredentialReaderPort,
    private readonly egress: ConnectorEgressPolicy,
  ) {}

  async load(
    orgId: string,
    connectorId: string,
  ): Promise<CiConnectorConnection> {
    const context = await this.repository.context(orgId, connectorId);
    const { connector, secret } = context;
    if (
      connector.organizationId !== orgId ||
      connector.id !== connectorId ||
      !connector.enabled ||
      connector.archivedAt ||
      !connector.hasSecret ||
      !secret ||
      secret.credentialRevision !== context.credentialRevision
    )
      throw new ConnectorError("invalid_state");

    const config = connector.connectionConfig;
    const parsed =
      connector.connectorType === "github_actions"
        ? githubActionsConnectorConfigurationSchema.safeParse(config)
        : connector.connectorType === "gitlab_ci"
          ? gitlabCiConnectorConfigurationSchema.safeParse(config)
          : connector.connectorType === "azure_devops"
            ? azureDevopsConnectorConfigurationSchema.safeParse(config)
            : null;
    if (!parsed?.success) throw new ConnectorError("invalid_state");
    await this.egress.validate(parsed.data, connector.connectorType);

    const value = await this.reader.read(
      {
        orgId,
        connectorId,
        secretId: secret.secretId,
        credentialRevision: secret.credentialRevision,
      },
      secret,
    );
    const base = {
      connectorId,
      secret: value,
      credentialRevision: context.credentialRevision,
      connectionRevision: context.connectionRevision,
    };
    switch (connector.connectorType) {
      case "github_actions":
        return {
          ...base,
          provider: "github_actions",
          config: githubActionsConnectorConfigurationSchema.parse(config),
        };
      case "gitlab_ci":
        return {
          ...base,
          provider: "gitlab_ci",
          config: gitlabCiConnectorConfigurationSchema.parse(config),
        };
      case "azure_devops":
        return {
          ...base,
          provider: "azure_devops",
          config: azureDevopsConnectorConfigurationSchema.parse(config),
        };
      default:
        throw new ConnectorError("invalid_state");
    }
  }
}
