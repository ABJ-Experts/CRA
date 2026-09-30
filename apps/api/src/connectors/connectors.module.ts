import { Module } from "@nestjs/common";

import { PermissionsModule } from "../permissions/permissions.module";
import { PermissionsService } from "../permissions/permissions.service";
import { ConnectorHubUseCases } from "./application/connector-hub-use-cases";
import { CiConnectorCredentialReader } from "./application/ci-connector-credential-reader";
import { ConnectorSyncOperationsUseCases } from "./application/connector-sync-operations-use-cases";
import { WebhookUseCases } from "./application/webhook-use-cases";
import { SupabaseSyncOperationsRepository } from "./infrastructure/supabase-sync-operations.repository";
import { SupabaseWebhookRepository } from "./infrastructure/supabase-webhook.repository";
import { ConnectorsSyncOperationsController } from "./connectors-sync-operations.controller";
import { ConnectorsWebhooksController } from "./connectors-webhooks.controller";
import { ConnectorAuthorizationAdapter } from "./infrastructure/connector-authorization.adapter";
import { ConnectorCredentialReader } from "./infrastructure/connector-vault-reader";
import { WebhookVault } from "./infrastructure/webhook-vault";
import { AesGcmConnectorVault } from "./infrastructure/connector-vault";
import { NodeConnectorEgressPolicy } from "./infrastructure/node-connector-egress.policy";
import { SupabaseConnectorHubRepository } from "./infrastructure/supabase-connector-hub.repository";
import { SupabaseModule } from "../supabase/supabase.module";
import { SupabaseService } from "../supabase/supabase.service";
import type {
  ConnectorPort,
  ConnectorType,
} from "./application/connector-port";
import { ConnectorsController } from "./connectors.controller";
import { ConnectorsService } from "./connectors.service";
import { SupabaseConnectorRepository } from "./infrastructure/supabase-connector.repository";
import { ReferenceConformanceAdapter } from "./reference-adapter/reference-conformance-adapter";
import { ConnectorSyncWorker } from "./worker/connector-sync-worker";
import { WebhookDeliveryWorker } from "./worker/webhook-delivery-worker";
import { NodeWebhookTransport } from "./infrastructure/node-webhook-transport";

export const CONNECTOR_PORTS = Symbol("CONNECTOR_PORTS");

@Module({
  imports: [SupabaseModule, PermissionsModule],
  controllers: [
    ConnectorsWebhooksController,
    ConnectorsSyncOperationsController,
    ConnectorsController,
  ],
  providers: [
    SupabaseConnectorRepository,
    {
      provide: SupabaseWebhookRepository,
      useFactory: (supabase: SupabaseService) =>
        new SupabaseWebhookRepository(supabase),
      inject: [SupabaseService],
    },
    {
      provide: SupabaseSyncOperationsRepository,
      useFactory: (supabase: SupabaseService) =>
        new SupabaseSyncOperationsRepository(supabase),
      inject: [SupabaseService],
    },
    {
      provide: CONNECTOR_PORTS,
      useFactory: () => {
        const adapter = new ReferenceConformanceAdapter();
        return new Map<ConnectorType, ConnectorPort>([
          [adapter.connectorType, adapter],
        ]);
      },
    },
    {
      provide: SupabaseConnectorHubRepository,
      useFactory: (
        supabase: SupabaseService,
        repository: SupabaseConnectorRepository,
      ) => new SupabaseConnectorHubRepository(supabase, repository),
      inject: [SupabaseService, SupabaseConnectorRepository],
    },
    {
      provide: ConnectorAuthorizationAdapter,
      useFactory: (
        repository: SupabaseConnectorHubRepository,
        permissions: PermissionsService,
      ) => new ConnectorAuthorizationAdapter(repository, permissions),
      inject: [SupabaseConnectorHubRepository, PermissionsService],
    },
    {
      provide: AesGcmConnectorVault,
      useFactory: () =>
        new AesGcmConnectorVault(process.env.CONNECTOR_VAULT_KEYRING),
    },
    {
      provide: ConnectorCredentialReader,
      useFactory: (vault: AesGcmConnectorVault) =>
        new ConnectorCredentialReader(
          vault,
          process.env.CONNECTOR_SECRET_ENCRYPTION_KEY,
          { binary: process.env.CONNECTOR_VAULT_GPG_BINARY },
        ),
      inject: [AesGcmConnectorVault],
    },
    {
      provide: CiConnectorCredentialReader,
      useFactory: (
        repository: SupabaseConnectorHubRepository,
        reader: ConnectorCredentialReader,
        egress: NodeConnectorEgressPolicy,
      ) => new CiConnectorCredentialReader(repository, reader, egress),
      inject: [
        SupabaseConnectorHubRepository,
        ConnectorCredentialReader,
        NodeConnectorEgressPolicy,
      ],
    },
    {
      provide: NodeConnectorEgressPolicy,
      useFactory: () =>
        new NodeConnectorEgressPolicy(
          (process.env.CONNECTOR_ALLOWED_HOSTS ?? "")
            .split(",")
            .filter(Boolean),
        ),
    },

    {
      provide: WebhookVault,
      useFactory: (vault: AesGcmConnectorVault) => new WebhookVault(vault),
      inject: [AesGcmConnectorVault],
    },
    {
      provide: NodeWebhookTransport,
      useFactory: () =>
        new NodeWebhookTransport(
          (process.env.WEBHOOK_ALLOWED_HOSTS ?? "").split(",").filter(Boolean),
        ),
    },
    {
      provide: WebhookUseCases,
      useFactory: (
        repository: SupabaseWebhookRepository,
        authorization: ConnectorAuthorizationAdapter,
        vault: WebhookVault,
        egress: NodeWebhookTransport,
      ) => new WebhookUseCases(repository, authorization, vault, egress),
      inject: [
        SupabaseWebhookRepository,
        ConnectorAuthorizationAdapter,
        WebhookVault,
        NodeWebhookTransport,
      ],
    },
    {
      provide: WebhookDeliveryWorker,
      useFactory: (
        repository: SupabaseWebhookRepository,
        vault: WebhookVault,
        transport: NodeWebhookTransport,
        authorization: ConnectorAuthorizationAdapter,
      ) =>
        new WebhookDeliveryWorker(
          repository,
          vault,
          transport,
          authorization,
          `webhook-delivery-${process.pid}`,
          60,
        ),
      inject: [
        SupabaseWebhookRepository,
        WebhookVault,
        NodeWebhookTransport,
        ConnectorAuthorizationAdapter,
      ],
    },
    {
      provide: ConnectorHubUseCases,
      useFactory: (
        repository: SupabaseConnectorHubRepository,
        authorization: ConnectorAuthorizationAdapter,
        vault: AesGcmConnectorVault,
        adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
        egress: NodeConnectorEgressPolicy,
        reader: ConnectorCredentialReader,
      ) =>
        new ConnectorHubUseCases(
          repository,
          authorization,
          vault,
          adapters,
          egress,
          10_000,
          reader,
        ),
      inject: [
        SupabaseConnectorHubRepository,
        ConnectorAuthorizationAdapter,
        AesGcmConnectorVault,
        CONNECTOR_PORTS,
        NodeConnectorEgressPolicy,
        ConnectorCredentialReader,
      ],
    },
    {
      provide: ConnectorSyncOperationsUseCases,
      useFactory: (
        repository: SupabaseSyncOperationsRepository,
        authorization: ConnectorAuthorizationAdapter,
        hub: SupabaseConnectorHubRepository,
        vault: AesGcmConnectorVault,
        adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
        egress: NodeConnectorEgressPolicy,
        reader: ConnectorCredentialReader,
      ) =>
        new ConnectorSyncOperationsUseCases(
          repository,
          authorization,
          hub,
          vault,
          adapters,
          egress,
          reader,
        ),
      inject: [
        SupabaseSyncOperationsRepository,
        ConnectorAuthorizationAdapter,
        SupabaseConnectorHubRepository,
        AesGcmConnectorVault,
        CONNECTOR_PORTS,
        NodeConnectorEgressPolicy,
        ConnectorCredentialReader,
      ],
    },
    {
      provide: ConnectorsService,
      useFactory: (
        repository: SupabaseConnectorRepository,
        adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
        hub: ConnectorHubUseCases,
      ) =>
        new ConnectorsService(
          repository,
          adapters,
          process.env.CONNECTOR_SECRET_ENCRYPTION_KEY ?? "",
          hub,
        ),
      inject: [
        SupabaseConnectorRepository,
        CONNECTOR_PORTS,
        ConnectorHubUseCases,
      ],
    },
    {
      provide: ConnectorSyncWorker,
      useFactory: (
        repository: SupabaseConnectorRepository,
        supabase: SupabaseService,
        adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
        hub: SupabaseConnectorHubRepository,
        authorization: ConnectorAuthorizationAdapter,
        vault: AesGcmConnectorVault,
        credentialReader: ConnectorCredentialReader,
        egress: NodeConnectorEgressPolicy,
      ) => {
        const encryptionKey = process.env.CONNECTOR_SECRET_ENCRYPTION_KEY ?? "";
        const workerId = `connector-sync-${process.pid}`;
        return new ConnectorSyncWorker(
          repository,
          supabase,
          adapters,
          encryptionKey,
          workerId,
          60,
          { hub, authorization, vault, credentialReader, egress },
        );
      },
      inject: [
        SupabaseConnectorRepository,
        SupabaseService,
        CONNECTOR_PORTS,
        SupabaseConnectorHubRepository,
        ConnectorAuthorizationAdapter,
        AesGcmConnectorVault,
        ConnectorCredentialReader,
        NodeConnectorEgressPolicy,
      ],
    },
  ],
  exports: [
    ConnectorSyncWorker,
    WebhookDeliveryWorker,
    CiConnectorCredentialReader,
  ],
})
export class ConnectorsModule {}
