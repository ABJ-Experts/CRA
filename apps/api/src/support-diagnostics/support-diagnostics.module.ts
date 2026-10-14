import { createHmac } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { SupabaseModule } from "../supabase/supabase.module";
import { SupabaseService } from "../supabase/supabase.service";
import { SupportDiagnosticsController } from "./support-diagnostics.controller";
import { SupportDiagnosticsUseCases } from "./application/support-diagnostics.use-cases";
import { SupabaseSupportDiagnosticsRepository } from "./infrastructure/supabase-support-diagnostics.repository";
import { DiagnosticPreviewTokens } from "./domain/diagnostic-preview-tokens";
import { DiagnosticArchive } from "./infrastructure/diagnostic-archive";
import { DiagnosticArtifactStore } from "./infrastructure/diagnostic-artifact.store";
@Module({
  imports: [ConfigModule, SupabaseModule],
  controllers: [SupportDiagnosticsController],
  providers: [
    SupabaseSupportDiagnosticsRepository,
    {
      provide: DiagnosticPreviewTokens,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new DiagnosticPreviewTokens(
          createHmac(
            "sha256",
            config.getOrThrow<string>("COOKIE_SIGNING_SECRET"),
          )
            .update("cra:m15_04:diagnostic-signing:v1")
            .digest("hex"),
        ),
    },
    { provide: DiagnosticArchive, useFactory: () => new DiagnosticArchive() },
    {
      provide: DiagnosticArtifactStore,
      inject: [SupabaseService],
      useFactory: (supabase: SupabaseService) =>
        new DiagnosticArtifactStore(supabase),
    },
    {
      provide: SupportDiagnosticsUseCases,
      inject: [
        SupabaseSupportDiagnosticsRepository,
        DiagnosticPreviewTokens,
        DiagnosticArtifactStore,
        DiagnosticArchive,
      ],
      useFactory: (
        repository: SupabaseSupportDiagnosticsRepository,
        tokens: DiagnosticPreviewTokens,
        artifacts: DiagnosticArtifactStore,
        archive: DiagnosticArchive,
      ) =>
        new SupportDiagnosticsUseCases(repository, tokens, artifacts, archive),
    },
  ],
  exports: [
    SupportDiagnosticsUseCases,
    SupabaseSupportDiagnosticsRepository,
    DiagnosticPreviewTokens,
    DiagnosticArchive,
    DiagnosticArtifactStore,
  ],
})
export class SupportDiagnosticsModule {}
