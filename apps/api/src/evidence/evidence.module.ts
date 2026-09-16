import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { EvidenceController } from "./evidence.controller";
import { EvidenceIntakeUseCases, EVIDENCE_REPOSITORY } from "./application/evidence-intake-use-cases";
import { SupabaseEvidenceRepository } from "./infrastructure/supabase-evidence.repository";
import { SupabaseEvidenceStorageAdapter } from "./infrastructure/supabase-evidence-storage.adapter";

@Module({
  imports: [SupabaseModule],
  controllers: [EvidenceController],
  providers: [
    SupabaseEvidenceRepository,
    SupabaseEvidenceStorageAdapter,
    { provide: EVIDENCE_REPOSITORY, useExisting: SupabaseEvidenceRepository },
    { provide: EvidenceIntakeUseCases, inject: [EVIDENCE_REPOSITORY, SupabaseEvidenceStorageAdapter], useFactory: (repository: SupabaseEvidenceRepository, storage: SupabaseEvidenceStorageAdapter) => new EvidenceIntakeUseCases(repository, storage) },
  ],
})
export class EvidenceModule {}
