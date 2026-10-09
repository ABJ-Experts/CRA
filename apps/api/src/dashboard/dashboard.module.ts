import { DashboardTrendsController } from "./dashboard-trends.controller";
import { DashboardTrendsUseCases } from "./application/dashboard-trends-use-cases";
import { DashboardDatasetCodec } from "./infrastructure/dashboard-dataset-codec";
import { SupabaseDashboardTrendsRepository } from "./infrastructure/supabase-dashboard-trends.repository";
import { Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PermissionsModule } from "../permissions/permissions.module";
import { SupabaseModule } from "../supabase/supabase.module";
import { DashboardUseCases } from "./application/dashboard-use-cases";
import { DashboardController } from "./dashboard.controller";
import { DashboardCursorCodec } from "./infrastructure/dashboard-cursor";
import { SupabaseDashboardPermissionsRepository } from "./infrastructure/supabase-dashboard-permissions.repository";
import { SupabaseDashboardRepository } from "./infrastructure/supabase-dashboard.repository";

@Module({
  imports: [SupabaseModule, PermissionsModule],
  controllers: [DashboardController, DashboardTrendsController],
  providers: [
    SupabaseDashboardTrendsRepository,
    {
      provide: DashboardDatasetCodec,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new DashboardDatasetCodec(
          config.getOrThrow<string>("COOKIE_SIGNING_SECRET"),
        ),
    },
    {
      provide: DashboardTrendsUseCases,
      inject: [
        SupabaseDashboardTrendsRepository,
        SupabaseDashboardPermissionsRepository,
        DashboardDatasetCodec,
      ],
      useFactory: (
        repository: SupabaseDashboardTrendsRepository,
        permissions: SupabaseDashboardPermissionsRepository,
        tokens: DashboardDatasetCodec,
      ) => new DashboardTrendsUseCases(repository, permissions, tokens),
    },
    SupabaseDashboardPermissionsRepository,
    SupabaseDashboardRepository,
    {
      provide: DashboardCursorCodec,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new DashboardCursorCodec(
          config.getOrThrow<string>("COOKIE_SIGNING_SECRET"),
        ),
    },
    {
      provide: DashboardUseCases,
      inject: [
        SupabaseDashboardRepository,
        SupabaseDashboardPermissionsRepository,
        DashboardCursorCodec,
      ],
      useFactory: (
        repository: SupabaseDashboardRepository,
        permissions: SupabaseDashboardPermissionsRepository,
        tokens: DashboardCursorCodec,
      ) =>
        new DashboardUseCases(repository, permissions, tokens, {
          readUnavailable: (endpoint, phase) =>
            new Logger("DashboardProjection").warn({ endpoint, phase }),
          sectionUnavailable: (source, classification) =>
            new Logger("DashboardProjection").warn({
              source,
              classification,
            }),
        }),
    },
  ],
})
export class DashboardModule {}
