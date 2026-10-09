import { SiemModule } from "./siem/siem.module";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { SupabaseModule } from "../supabase/supabase.module";
import { AuditExplorerController } from "./audit-explorer.controller";
import { AuditExplorerDeniedFilter } from "./audit-explorer-denied.filter";
import { AUDIT_EXPLORER_REPOSITORY } from "./application/audit-explorer.port";
import { AuditExplorerTokenService } from "./audit-explorer-token.service";
import { AuditExplorerUseCases } from "./application/audit-explorer.use-cases";
import { AuditRangeController } from "./range/audit-range.controller";
import { AuditRangeDeniedFilter } from "./range/audit-range-denied.filter";
import { AuditRangeUseCases } from "./range/application/audit-range.use-cases";
import { AUDIT_RANGE_REPOSITORY } from "./range/application/audit-range.port";
import { SupabaseAuditRangeRepository } from "./range/infrastructure/supabase-audit-range.repository";
import { AuditService } from "./audit.service";
import { SupabaseAuditExportStorageAdapter } from "./infrastructure/audit-export-storage.adapter";
import { SupabaseAuditExplorerRepository } from "./supabase-audit-explorer.repository";

@Module({
  imports: [ConfigModule, SupabaseModule, SiemModule],
  controllers: [AuditExplorerController, AuditRangeController],
  providers: [
    AuditService,
    SupabaseAuditRangeRepository,
    AuditRangeDeniedFilter,
    {
      provide: AUDIT_RANGE_REPOSITORY,
      useExisting: SupabaseAuditRangeRepository,
    },
    {
      provide: AuditRangeUseCases,
      useFactory: (
        repository: SupabaseAuditRangeRepository,
        permissions: SupabaseAuditExplorerRepository,
      ) => new AuditRangeUseCases(repository, permissions),
      inject: [SupabaseAuditRangeRepository, SupabaseAuditExplorerRepository],
    },
    {
      provide: AuditExplorerUseCases,
      useFactory: (
        repository: SupabaseAuditExplorerRepository,
        tokens: AuditExplorerTokenService,
      ) => new AuditExplorerUseCases(repository, tokens),
      inject: [SupabaseAuditExplorerRepository, AuditExplorerTokenService],
    },
    AuditExplorerTokenService,
    AuditExplorerDeniedFilter,
    SupabaseAuditExportStorageAdapter,
    SupabaseAuditExplorerRepository,
    {
      provide: AUDIT_EXPLORER_REPOSITORY,
      useExisting: SupabaseAuditExplorerRepository,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
