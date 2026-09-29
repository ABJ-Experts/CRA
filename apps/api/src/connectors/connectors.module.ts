import { Module } from "@nestjs/common";

import { PermissionsModule } from "../permissions/permissions.module";
import { PermissionsService } from "../permissions/permissions.service";
import { ConnectorHubUseCases } from "./application/connector-hub-use-cases";
import { ConnectorAuthorizationAdapter } from "./infrastructure/connector-authorization.adapter";
import { ConnectorCredentialReader } from "./infrastructure/connector-vault-reader";
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

export const CONNECTOR_PORTS = Symbol("CONNECTOR_PORTS");

@Module({
  imports: [SupabaseModule, PermissionsModule],
  controllers: [ConnectorsController],
  providers: [
    SupabaseConnectorRepository,
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
      provide: NodeConnectorEgressPolicy,
      useFactory: () =>
        new NodeConnectorEgressPolicy(
          (process.env.CONNECTOR_ALLOWED_HOSTS ?? "")
            .split(",")
            .filter(Boolean),
        ),
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
  exports: [ConnectorSyncWorker],
})
export class ConnectorsModule {}
