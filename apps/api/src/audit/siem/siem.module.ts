import { SupabaseAuditExportStorageAdapter } from "../infrastructure/audit-export-storage.adapter";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { SupabaseModule } from "../../supabase/supabase.module";
import { SupabaseAuditExplorerRepository } from "../supabase-audit-explorer.repository";
import { SiemController } from "./siem.controller";
import { SiemDeniedFilter } from "./siem-denied.filter";
import { SiemUseCases } from "./application/siem-use-cases";
import { SupabaseSiemRepository } from "./infrastructure/supabase-siem.repository";
import {
  NodeSiemTransport,
  parseSiemApprovedTargets,
} from "./infrastructure/node-siem-transport";
import { SiemVault } from "./infrastructure/siem-vault";
import { AesGcmConnectorVault } from "../../connectors/infrastructure/connector-vault";
@Module({
  imports: [ConfigModule, SupabaseModule],
  controllers: [SiemController],
  providers: [
    SupabaseAuditExportStorageAdapter,
    SupabaseSiemRepository,
    SiemDeniedFilter,
    SupabaseAuditExplorerRepository,
    {
      provide: SiemVault,
      useFactory: (config: ConfigService) =>
        new SiemVault(
          new AesGcmConnectorVault(
            config.get<string>("CONNECTOR_VAULT_KEYRING"),
          ),
        ),
      inject: [ConfigService],
    },
    {
      provide: NodeSiemTransport,
      useFactory: (config: ConfigService) =>
        new NodeSiemTransport(
          parseSiemApprovedTargets(
            config.get<string>("SIEM_APPROVED_TARGETS_JSON"),
          ),
        ),
      inject: [ConfigService],
    },
    {
      provide: SiemUseCases,
      useFactory: (
        repository: SupabaseSiemRepository,
        permissions: SupabaseAuditExplorerRepository,
        vault: SiemVault,
        transport: NodeSiemTransport,
      ) => new SiemUseCases(repository, permissions, vault, transport),
      inject: [
        SupabaseSiemRepository,
        SupabaseAuditExplorerRepository,
        SiemVault,
        NodeSiemTransport,
      ],
    },
  ],
  exports: [SupabaseSiemRepository, SiemVault, NodeSiemTransport],
})
export class SiemModule {}
