import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PermissionsModule } from "../permissions/permissions.module";
import { PermissionsService } from "../permissions/permissions.service";
import { SupabaseModule } from "../supabase/supabase.module";
import { ReportsUseCases } from "./application/reports.use-cases";
import { SupabaseReportsRepository } from "./infrastructure/supabase-reports.repository";
import { ReportsController } from "./reports.controller";

@Module({
  imports: [ConfigModule, PermissionsModule, SupabaseModule],
  controllers: [ReportsController],
  providers: [
    SupabaseReportsRepository,
    {
      provide: ReportsUseCases,
      useFactory: (
        repository: SupabaseReportsRepository,
        permissions: PermissionsService,
        config: ConfigService,
      ) =>
        new ReportsUseCases(
          repository,
          permissions,
          () => config.get<string>("REPORTS_CREATION_ENABLED") !== "false",
        ),
      inject: [SupabaseReportsRepository, PermissionsService, ConfigService],
    },
  ],
})
export class ReportsModule {}
