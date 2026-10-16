import {
  connectorCapabilitiesSchema,
  connectorPullPageSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  PreviewConnectorFieldMappingInput,
  SaveConnectorFieldMappingInput,
  SyncHistoryQuery,
  ReplaySyncRunPreviewInput,
  ReplaySyncRunInput,
  ConnectorMappingPreview,
} from "@repo/contracts/connectors/types";
import type { ConnectorSyncOperationsRepository } from "./connector-sync-operations.port";
import type { ConnectorAuthorizationPort } from "./connector-authorization.port";
import type {
  ConnectorHubRepository,
  ConnectorEgressPolicy,
} from "./connector-hub-repository.port";
import type {
  ConnectorCredentialReaderPort,
  ConnectorVaultPort,
} from "./connector-vault.port";
import type {
  ConnectorPort,
  ConnectorType,
  ConnectorConnectionConfig,
} from "./connector-port";
import { ConnectorError } from "./connector-errors";
import { canonicalConnectorRequest } from "./connector-hub-use-cases";
import {
  applyConnectorFieldMappings,
  protectConnectorSourceRecord,
  hasConnectorCredentialEcho,
  connectorMappingDiscovery,
  validateConnectorFieldMappings,
} from "./connector-field-mapping-policy";

export class ConnectorSyncOperationsUseCases {
  constructor(
    private readonly repository: ConnectorSyncOperationsRepository,
    private readonly authorization: ConnectorAuthorizationPort,
    private readonly hub: ConnectorHubRepository,
    private readonly vault: ConnectorVaultPort,
    private readonly adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
    private readonly egress: ConnectorEgressPolicy,
    private readonly reader: ConnectorCredentialReaderPort,
  ) {}
  async currentMapping(orgId: string, connectorId: string, actorId: string) {
    await this.readAccess(orgId, actorId);
    return this.repository.currentMapping(orgId, connectorId);
  }
  async mappingSchema(orgId: string, connectorId: string, actorId: string) {
    return connectorMappingDiscovery(
      (await this.discover(orgId, connectorId, actorId)).capabilities,
    );
  }
  async previewMapping(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: PreviewConnectorFieldMappingInput,
  ): Promise<ConnectorMappingPreview> {
    const discovery = await this.discover(orgId, connectorId, actorId, true);
    const schema = connectorMappingDiscovery(discovery.capabilities);
    const issues = validateConnectorFieldMappings(
      input.fields,
      discovery.capabilities,
    );
    if (issues.length)
      return {
        schema,
        fields: input.fields,
        issues,
        samples: [],
        valid: false,
      };
    await this.authorization.authorize(orgId, actorId, ["can_edit_connectors"]);
    await this.egress.validate(discovery.connectionConfig);
    const raw = await this.providerCall(
      () => discovery.adapter.pull(discovery.config, null, 10),
      discovery.config.signal!,
    );
    const parsed = connectorPullPageSchema.safeParse(raw);
    if (!parsed.success) throw new ConnectorError("unavailable");
    const page = parsed.data;
    if (
      page.adapterSignal !== "ok" ||
      page.records.length > 10 ||
      hasConnectorCredentialEcho(
        [page.nextCursor?.token, page.nextCursor?.watermark],
        discovery.config.secretReference.reference,
      )
    )
      throw new ConnectorError("unavailable");
    const samples = page.records.map((record) => {
      const protectedSource = protectConnectorSourceRecord(
        record,
        discovery.config.secretReference.reference,
      );
      issues.push(...protectedSource.issues);
      const mapped = applyConnectorFieldMappings(
        protectedSource.record,
        input.fields,
        discovery.capabilities,
      );
      issues.push(...mapped.issues);
      return {
        entityType: record.entityType,
        externalId: protectedSource.record.externalId,
        fields: { ...mapped.record.fields },
      };
    });
    await this.authorization.authorize(orgId, actorId, ["can_edit_connectors"]);
    const current = await this.hub.context(orgId, connectorId);
    if (current.connectionRevision !== discovery.connectionRevision)
      throw new ConnectorError("stale_preview");
    return {
      schema,
      fields: input.fields,
      issues,
      samples,
      valid: issues.length === 0,
    };
  }
  async saveMapping(
    orgId: string,
    connectorId: string,
    actorId: string,
    input: SaveConnectorFieldMappingInput,
  ) {
    await this.authorization.authorize(orgId, actorId, ["can_edit_connectors"]);
    const retained = await this.hub.command(
      orgId,
      connectorId,
      actorId,
      input.idempotencyKey,
    );
    if (
      retained?.state !== "completed" ||
      retained.operation !== "save_field_mapping"
    ) {
      const { capabilities } = await this.discover(
        orgId,
        connectorId,
        actorId,
        true,
      );
      if (
        connectorMappingDiscovery(capabilities).schemaDigest !==
        input.schemaDigest
      )
        throw new ConnectorError("stale_preview");
      if (validateConnectorFieldMappings(input.fields, capabilities).length)
        throw new ConnectorError("invalid_request");
    }
    const authorization = await this.authorization.authorize(orgId, actorId, [
      "can_edit_connectors",
    ]);
    const fingerprint = await this.fingerprint(
      orgId,
      connectorId,
      actorId,
      "save_field_mapping",
      input,
    );
    return this.repository.saveMapping(
      orgId,
      connectorId,
      authorization,
      input,
      fingerprint,
    );
  }
  async history(
    orgId: string,
    connectorId: string,
    actorId: string,
    query: SyncHistoryQuery,
  ) {
    await this.readAccess(orgId, actorId);
    return this.repository.history(orgId, connectorId, query);
  }
  async detail(
    orgId: string,
    connectorId: string,
    runId: string,
    actorId: string,
    query: SyncHistoryQuery,
  ) {
    await this.readAccess(orgId, actorId);
    return this.repository.detail(orgId, connectorId, runId, query);
  }
  async deadLetters(
    orgId: string,
    connectorId: string,
    actorId: string,
    query: SyncHistoryQuery,
  ) {
    await this.readAccess(orgId, actorId);
    return this.repository.deadLetters(orgId, connectorId, query);
  }
  async replayPreview(
    orgId: string,
    connectorId: string,
    runId: string,
    actorId: string,
    input: ReplaySyncRunPreviewInput,
  ) {
    const authorization = await this.authorization.authorize(orgId, actorId, [
      "can_edit_connectors",
    ]);
    return this.repository.replayPreview(
      orgId,
      connectorId,
      runId,
      authorization,
      input,
    );
  }
  async replay(
    orgId: string,
    connectorId: string,
    runId: string,
    actorId: string,
    input: ReplaySyncRunInput,
  ) {
    const authorization = await this.authorization.authorize(orgId, actorId, [
      "can_edit_connectors",
    ]);
    const fingerprint = await this.fingerprint(
      orgId,
      connectorId,
      actorId,
      "replay_sync_run",
      { ...input, runId },
    );
    return this.repository.replay(
      orgId,
      connectorId,
      runId,
      authorization,
      input,
      fingerprint,
    );
  }
  private readAccess(orgId: string, actorId: string) {
    return this.authorization.authorize(orgId, actorId, [
      "can_view_connectors",
    ]);
  }
  private async fingerprint<T extends { idempotencyKey: string }>(
    orgId: string,
    connectorId: string,
    actorId: string,
    operation: string,
    input: T,
  ) {
    const retained = await this.hub.command(
      orgId,
      connectorId,
      actorId,
      input.idempotencyKey,
    );
    try {
      return this.vault.fingerprint(
        orgId,
        connectorId,
        canonicalConnectorRequest({ operation, input }),
        retained?.requestDigestKeyId,
      );
    } catch {
      throw new ConnectorError("unavailable");
    }
  }
  private async providerCall<T>(
    call: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        call(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ConnectorError("unavailable")),
            10_000,
          );
          if (signal.aborted) reject(new ConnectorError("unavailable"));
        }),
      ]);
    } catch {
      throw new ConnectorError("unavailable");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async discover(
    orgId: string,
    connectorId: string,
    actorId: string,
    edit = false,
  ) {
    await this.authorization.authorize(orgId, actorId, [
      edit ? "can_edit_connectors" : "can_view_connectors",
    ]);
    const context = await this.hub.context(orgId, connectorId);
    const adapter = this.adapters.get(context.connector.connectorType);
    if (!adapter || !context.secret) throw new ConnectorError("unavailable");
    const signal = AbortSignal.timeout(10_000);
    let secret: string;
    try {
      secret = await this.reader.read(
        {
          orgId,
          connectorId,
          secretId: context.secret.secretId,
          credentialRevision: context.secret.credentialRevision,
        },
        context.secret,
        signal,
      );
    } catch {
      throw new ConnectorError("unavailable");
    }
    await this.egress.validate(context.connector.connectionConfig);
    const config: ConnectorConnectionConfig = {
      connectorType: context.connector.connectorType,
      ...context.connector.connectionConfig,
      secretReference: { provider: "reference_fixture", reference: secret },
      executionIdentity: `${orgId}:${connectorId}:mapping`,
      signal,
    };
    const raw: unknown = await this.providerCall(
      () => adapter.discoverCapabilities(config),
      signal,
    );
    const parsed = connectorCapabilitiesSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.adapterVersion !== context.connector.adapterVersion
    )
      throw new ConnectorError("unavailable");
    const metadata = [
      parsed.data.adapterVersion,
      parsed.data.mappingVersion,
      ...parsed.data.entities.flatMap((entry) =>
        entry.fields.flatMap((field) => [field.field, field.vendorFieldPath]),
      ),
    ];
    if (hasConnectorCredentialEcho(metadata, secret))
      throw new ConnectorError("unavailable");
    await this.authorization.authorize(orgId, actorId, [
      edit ? "can_edit_connectors" : "can_view_connectors",
    ]);
    const current = await this.hub.context(orgId, connectorId);
    if (current.connectionRevision !== context.connectionRevision)
      throw new ConnectorError("stale_preview");
    return {
      adapter,
      config,
      connectionConfig: context.connector.connectionConfig,
      capabilities: parsed.data,
      connectionRevision: context.connectionRevision,
    };
  }
}
