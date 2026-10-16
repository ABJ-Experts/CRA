import { ExportSourceContextAdapter } from "./infrastructure/export-source-context.adapter";
import { DashboardModule } from "../dashboard/dashboard.module";
import { AuditModule } from "../audit/audit.module";
import { PortalExportsController } from "./portal-exports.controller";
import { PortalExportsUseCases } from "./application/portal-exports.use-cases";
import { SupabasePortalExportsRepository } from "./infrastructure/supabase-portal-exports.repository";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { SupabaseModule } from "../supabase/supabase.module";
import { PermissionsModule } from "../permissions/permissions.module";
import { PermissionsService } from "../permissions/permissions.service";
import {
  ExportsController,
  ProductReadinessExportsController,
} from "./exports.controller";
import { ExportsUseCases } from "./application/exports.use-cases";
import { SupabaseExportsRepository } from "./infrastructure/supabase-exports.repository";
@Module({
  imports: [
    ConfigModule,
    SupabaseModule,
    PermissionsModule,
    DashboardModule,
    AuditModule,
  ],
  controllers: [
    ExportsController,
    ProductReadinessExportsController,
    PortalExportsController,
  ],
  providers: [
    ExportSourceContextAdapter,
    SupabaseExportsRepository,
    SupabasePortalExportsRepository,
    {
      provide: PortalExportsUseCases,
      useFactory: (
        repository: SupabasePortalExportsRepository,
        config: ConfigService,
      ) =>
        new PortalExportsUseCases(
          repository,
          () => config.get<string>("EXPORTS_CREATION_ENABLED") !== "false",
        ),
      inject: [SupabasePortalExportsRepository, ConfigService],
    },
    {
      provide: ExportsUseCases,
      useFactory: (
        repository: SupabaseExportsRepository,
        permissions: PermissionsService,
        config: ConfigService,
        sourceContexts: ExportSourceContextAdapter,
      ) =>
        new ExportsUseCases(
          repository,
          permissions,
          () => config.get<string>("EXPORTS_CREATION_ENABLED") !== "false",
          sourceContexts,
        ),
      inject: [
        SupabaseExportsRepository,
        PermissionsService,
        ConfigService,
        ExportSourceContextAdapter,
      ],
    },
  ],
  exports: [SupabaseExportsRepository],
})
export class ExportsModule {}
