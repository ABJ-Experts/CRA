import { Module } from "@nestjs/common";

import { MailModule } from "../mail/mail.module";
import { SupabaseModule } from "../supabase/supabase.module";
import { SupabaseEvidenceStorageAdapter } from "../evidence/infrastructure/supabase-evidence-storage.adapter";
import {
  SupplierEvidenceUseCases,
  SUPPLIER_EVIDENCE_REPOSITORY,
  type SupplierEvidenceRepository,
} from "./application/supplier-evidence-use-cases";
import { SupabaseSupplierEvidenceRepository } from "./infrastructure/supabase-supplier-evidence.repository";
import { SupplierDocumentExtractionUseCases } from "./application/supplier-document-extraction.use-cases";
import { SupabaseSupplierDocumentExtractionRepository } from "./infrastructure/supabase-supplier-document-extraction.repository";
import { SupplierDocumentExtractionController } from "./supplier-document-extraction.controller";
import {
  SupplierEvidencePortalController,
  SupplierEvidenceRequestsController,
} from "./supplier-evidence.controller";

@Module({
  imports: [SupabaseModule, MailModule],
  controllers: [
    SupplierEvidenceRequestsController,
    SupplierEvidencePortalController,
    SupplierDocumentExtractionController,
  ],
  providers: [
    SupabaseEvidenceStorageAdapter,
    SupabaseSupplierEvidenceRepository,
    SupabaseSupplierDocumentExtractionRepository,
    {
      provide: SupplierDocumentExtractionUseCases,
      inject: [SupabaseSupplierDocumentExtractionRepository],
      useFactory: (repository: SupabaseSupplierDocumentExtractionRepository) =>
        new SupplierDocumentExtractionUseCases(repository),
    },
    {
      provide: SUPPLIER_EVIDENCE_REPOSITORY,
      useExisting: SupabaseSupplierEvidenceRepository,
    },
    {
      provide: SupplierEvidenceUseCases,
      inject: [SUPPLIER_EVIDENCE_REPOSITORY, SupabaseEvidenceStorageAdapter],
      useFactory: (
        repository: SupplierEvidenceRepository,
        storage: SupabaseEvidenceStorageAdapter,
      ) => new SupplierEvidenceUseCases(repository, storage),
    },
  ],
})
export class SupplierEvidenceModule {}
