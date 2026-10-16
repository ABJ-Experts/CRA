import { jiraConnectorConfigurationSchema } from "@repo/contracts/connectors/schemas";
import { z } from "zod";
import { ConnectorError } from "./connector-errors";
import type {
  ConnectorEgressPolicy,
  ConnectorHubRepository,
} from "./connector-hub-repository.port";
import type { ConnectorCredentialReaderPort } from "./connector-vault.port";

export type JiraConnectorConnection = Readonly<{
  connectorId: string;
  provider: "jira";
  config: z.output<typeof jiraConnectorConfigurationSchema>;
  token: string;
  webhookSecret: string;
  credentialRevision: number;
  connectionRevision: number;
}>;

const jiraSecretBundleSchema = z
  .object({
    token: z.string().min(1),
    webhookSecret: z
      .string()
      .refine((value) => Buffer.byteLength(value, "utf8") >= 32),
  })
  .strict();

/** Server-only, org-scoped credential seam for the Jira adapter. */
export class JiraConnectorCredentialReader {
  constructor(
    private readonly repository: Pick<ConnectorHubRepository, "context">,
    private readonly reader: ConnectorCredentialReaderPort,
    private readonly egress: ConnectorEgressPolicy,
  ) {}

  async load(
    orgId: string,
    connectorId: string,
  ): Promise<JiraConnectorConnection> {
    const context = await this.repository.context(orgId, connectorId);
    const { connector, secret } = context;
    if (
      connector.organizationId !== orgId ||
      connector.id !== connectorId ||
      connector.connectorType !== "jira" ||
      !connector.enabled ||
      connector.archivedAt ||
      !connector.hasSecret ||
      !secret ||
      secret.legacy ||
      secret.credentialRevision !== context.credentialRevision
    )
      throw new ConnectorError("invalid_state");

    const parsed = jiraConnectorConfigurationSchema.safeParse(
      connector.connectionConfig,
    );
    if (!parsed.success) throw new ConnectorError("invalid_state");
    await this.egress.validate(parsed.data, "jira");
    const credentials = await this.readCredentials(orgId, connectorId, secret);

    return {
      connectorId,
      provider: "jira",
      config: parsed.data,
      token: credentials.token,
      webhookSecret: credentials.webhookSecret,
      credentialRevision: context.credentialRevision,
      connectionRevision: context.connectionRevision,
    };
  }

  private async readCredentials(
    orgId: string,
    connectorId: string,
    secret: Parameters<ConnectorCredentialReaderPort["read"]>[1] & {
      secretId: string;
      credentialRevision: number;
    },
  ): Promise<z.output<typeof jiraSecretBundleSchema>> {
    const raw = await this.reader.read(
      {
        orgId,
        connectorId,
        secretId: secret.secretId,
        credentialRevision: secret.credentialRevision,
      },
      secret,
    );
    try {
      return jiraSecretBundleSchema.parse(JSON.parse(raw));
    } catch {
      throw new ConnectorError("invalid_state");
    }
  }
}
