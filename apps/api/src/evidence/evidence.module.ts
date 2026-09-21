import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { EvidenceController } from "./evidence.controller";
import {
  EvidenceIntakeUseCases,
  EVIDENCE_REPOSITORY,
} from "./application/evidence-intake-use-cases";
import { SupabaseEvidenceRepository } from "./infrastructure/supabase-evidence.repository";
import { SupabaseEvidenceStorageAdapter } from "./infrastructure/supabase-evidence-storage.adapter";
import {
  EvidenceAccessUseCases,
  EVIDENCE_ACCESS_REPOSITORY,
} from "./application/evidence-access-use-cases";
import {
  EvidenceTextSearchUseCases,
  EVIDENCE_TEXT_SEARCH_REPOSITORY,
} from "./application/evidence-text-search-use-cases";
import {
  EvidenceReuseValidityUseCases,
  EVIDENCE_REUSE_VALIDITY_REPOSITORY,
} from "./application/evidence-reuse-validity-use-cases";

@Module({
  imports: [SupabaseModule],
  controllers: [EvidenceController],
  providers: [
    SupabaseEvidenceRepository,
    SupabaseEvidenceStorageAdapter,
    { provide: EVIDENCE_REPOSITORY, useExisting: SupabaseEvidenceRepository },
    {
      provide: EVIDENCE_ACCESS_REPOSITORY,
      useExisting: SupabaseEvidenceRepository,
    },
    {
      provide: EvidenceIntakeUseCases,
      inject: [EVIDENCE_REPOSITORY, SupabaseEvidenceStorageAdapter],
      useFactory: (
        repository: SupabaseEvidenceRepository,
        storage: SupabaseEvidenceStorageAdapter,
      ) => new EvidenceIntakeUseCases(repository, storage),
    },
    {
      provide: EvidenceAccessUseCases,
      inject: [EVIDENCE_ACCESS_REPOSITORY],
      useFactory: (repository: SupabaseEvidenceRepository) =>
        new EvidenceAccessUseCases(repository),
    },
    {
      provide: EVIDENCE_TEXT_SEARCH_REPOSITORY,
      useExisting: SupabaseEvidenceRepository,
    },
    {
      provide: EvidenceTextSearchUseCases,
      inject: [EVIDENCE_TEXT_SEARCH_REPOSITORY],
      useFactory: (repository: SupabaseEvidenceRepository) =>
        new EvidenceTextSearchUseCases(repository),
    },
    {
      provide: EVIDENCE_REUSE_VALIDITY_REPOSITORY,
      useExisting: SupabaseEvidenceRepository,
    },
    {
      provide: EvidenceReuseValidityUseCases,
      inject: [EVIDENCE_REUSE_VALIDITY_REPOSITORY],
      useFactory: (repository: SupabaseEvidenceRepository) =>
        new EvidenceReuseValidityUseCases(repository),
    },
  ],
})
export class EvidenceModule {}
