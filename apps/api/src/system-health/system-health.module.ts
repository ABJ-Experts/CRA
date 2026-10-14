import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { systemHealthVersionSchema } from "@repo/contracts/system/schemas";
import { SupabaseModule } from "../supabase/supabase.module";
import { SupabaseService } from "../supabase/supabase.service";
import { LicensingRuntimeModule } from "../licensing/licensing-runtime.module";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { SystemHealthController } from "./system-health.controller";
import { SystemHealthUseCases } from "./application/system-health.use-cases";
import { SupabaseHealthSourceAdapter } from "./infrastructure/supabase-health-source.adapter";
import { RuntimeHealthAdapter } from "./infrastructure/runtime-health.adapter";
@Module({
  imports: [SupabaseModule, AuditModule, ConfigModule, LicensingRuntimeModule],
  controllers: [SystemHealthController],
  providers: [
    SupabaseHealthSourceAdapter,
    {
      provide: RuntimeHealthAdapter,
      inject: [SupabaseService, AuditService, ConfigService],
      useFactory: (
        supabase: SupabaseService,
        audit: AuditService,
        config: ConfigService,
      ) => new RuntimeHealthAdapter(supabase, audit, config),
    },
    {
      provide: SystemHealthUseCases,
      inject: [
        SupabaseHealthSourceAdapter,
        RuntimeHealthAdapter,
        ConfigService,
      ],
      useFactory: (
        sources: SupabaseHealthSourceAdapter,
        runtime: RuntimeHealthAdapter,
        config: ConfigService,
      ) => {
        const manifest = config.get<unknown>("SYSTEM_HEALTH_BUILD_MANIFEST");
        const parsed = systemHealthVersionSchema
          .pick({ version: true, commit: true, builtAt: true })
          .strict()
          .safeParse(
            typeof manifest === "string" ? JSON.parse(manifest) : manifest,
          );
        return new SystemHealthUseCases(
          sources,
          runtime,
          parsed.success
            ? {
                ...parsed.data,
                sourceAt: parsed.data.builtAt,
                observedAt: new Date().toISOString(),
              }
            : null,
        );
      },
    },
  ],
  exports: [SystemHealthUseCases, SupabaseHealthSourceAdapter],
})
export class SystemHealthModule {}
