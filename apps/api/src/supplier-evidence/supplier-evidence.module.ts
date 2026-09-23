import { Module } from "@nestjs/common";

import { MailModule } from "../mail/mail.module";
import { SupabaseModule } from "../supabase/supabase.module";
import { SbomModule } from "../sboms/sbom.module";
import { SupplierSbomService } from "../sboms/supplier-sbom.service";
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
import { SupplierEvidenceSbomUseCases } from "./application/supplier-evidence-sbom.use-cases";
import { SupabaseSupplierEvidenceSbomRepository } from "./infrastructure/supabase-supplier-evidence-sbom.repository";
import {
  SupplierEvidenceSbomInternalController,
  SupplierEvidenceSbomPortalController,
} from "./supplier-evidence-sbom.controller";
import {
  SupplierEvidencePortalController,
  SupplierEvidenceRequestsController,
} from "./supplier-evidence.controller";

@Module({
  imports: [SupabaseModule, MailModule, SbomModule],
  controllers: [
    SupplierEvidenceSbomInternalController,
    SupplierEvidenceRequestsController,
    SupplierEvidencePortalController,
    SupplierDocumentExtractionController,
    SupplierEvidenceSbomPortalController,
  ],
  providers: [
    SupabaseEvidenceStorageAdapter,
    SupabaseSupplierEvidenceRepository,
    SupabaseSupplierDocumentExtractionRepository,
    SupabaseSupplierEvidenceSbomRepository,
    {
      provide: SupplierEvidenceSbomUseCases,
      inject: [SupabaseSupplierEvidenceSbomRepository, SupplierSbomService],
      useFactory: (
        repository: SupabaseSupplierEvidenceSbomRepository,
        suppliers: SupplierSbomService,
      ) => new SupplierEvidenceSbomUseCases(repository, suppliers),
    },
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
