import { Module } from "@nestjs/common";

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
  imports: [SupabaseModule],
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
      provide: ConnectorsService,
      useFactory: (
        repository: SupabaseConnectorRepository,
        adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
      ) =>
        new ConnectorsService(
          repository,
          adapters,
          process.env.CONNECTOR_SECRET_ENCRYPTION_KEY ?? "",
        ),
      inject: [SupabaseConnectorRepository, CONNECTOR_PORTS],
    },
    {
      provide: ConnectorSyncWorker,
      useFactory: (
        repository: SupabaseConnectorRepository,
        supabase: SupabaseService,
        adapters: ReadonlyMap<ConnectorType, ConnectorPort>,
      ) => {
        const encryptionKey = process.env.CONNECTOR_SECRET_ENCRYPTION_KEY ?? "";
        const workerId = `connector-sync-${process.pid}`;
        return new ConnectorSyncWorker(
          repository,
          supabase,
          adapters,
          encryptionKey,
          workerId,
        );
      },
      inject: [SupabaseConnectorRepository, SupabaseService, CONNECTOR_PORTS],
    },
  ],
  exports: [ConnectorSyncWorker],
})
export class ConnectorsModule {}
