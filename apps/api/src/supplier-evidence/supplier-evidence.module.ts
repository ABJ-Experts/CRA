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
import {
  SupplierEvidencePortalController,
  SupplierEvidenceRequestsController,
} from "./supplier-evidence.controller";

@Module({
  imports: [SupabaseModule, MailModule],
  controllers: [
    SupplierEvidenceRequestsController,
    SupplierEvidencePortalController,
  ],
  providers: [
    SupabaseEvidenceStorageAdapter,
    SupabaseSupplierEvidenceRepository,
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
