import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { SupabaseModule } from "../supabase/supabase.module";
import { SupabaseService } from "../supabase/supabase.service";
import { SupabaseBsiEvidenceAdapter } from "./infrastructure/supabase-bsi-evidence.adapter";
import { extractBsiProfileFacts } from "./validation/bsi-profile-extractor";
import { SbomExportController } from "./sbom-export.controller";
import {
  SBOM_EXPORT_REPOSITORY,
  SbomExportUseCases,
} from "./application/sbom-export-use-cases";
import { SupabaseSbomExportRepository } from "./infrastructure/supabase-sbom-export.repository";
import { SBOM_CI_CREDENTIALS } from "./application/sbom-ci-credential.port";
import {
  SBOM_INTAKE_REPOSITORY,
  SbomIntakeUseCases,
} from "./application/sbom-intake-use-cases";
import {
  SUPPLIER_SBOM_REPOSITORY,
  SupplierSbomUseCases,
} from "./application/supplier-sbom-use-cases";
import {
  SBOM_NORMALIZATION_REPOSITORY,
  SbomNormalizationUseCases,
} from "./application/sbom-normalization-use-cases";
import {
  SBOM_QUALITY_REPOSITORY,
  SbomQualityUseCases,
} from "./application/sbom-quality-use-cases";
import {
  SBOM_DIFF_REPOSITORY,
  SbomDiffUseCases,
} from "./application/sbom-diff-use-cases";
import {
  SBOM_COMPOSITE_REPOSITORY,
  SbomCompositeUseCases,
} from "./application/sbom-composite-use-cases";
import { SupabaseSbomRepository } from "./infrastructure/supabase-sbom.repository";
import { SupabaseSbomStorageAdapter } from "./infrastructure/supabase-sbom-storage.adapter";
import { SbomCiCredentialsController } from "./sbom-ci-credentials.controller";
import {
  ProductReleaseSbomCompositeController,
  SbomCompositeReviewsController,
} from "./sbom-composite.controller";
import { SbomCiCredentialGuard } from "./sbom-ci-credential.guard";
import {
  ProductReleaseSbomController,
  SbomCiController,
  SbomDocumentsController,
  SbomDiffsController,
  SbomJobsController,
  SbomQualitySettingsController,
  SbomSourcesController,
  SbomUploadsController,
} from "./sbom.controller";
import { SbomService } from "./sbom.service";
import { SupplierSbomService } from "./supplier-sbom.service";
import {
  ProductReleaseSupplierSbomController,
  SupplierSbomPortalController,
  SupplierSbomRequestsController,
  SupplierSbomSubmissionsController,
} from "./supplier-sbom.controller";
import { validateSbomInWorker } from "./validation/sbom-validation-worker";
import { SbomIngestWorker } from "./worker/sbom-ingest-worker";
import { SbomQualityWorker } from "./worker/sbom-quality-worker";
import { SbomDiffWorker } from "./worker/sbom-diff-worker";
import { createM4SbomDiffVersionComparator } from "./infrastructure/m4-sbom-diff-version-comparator";
import { SbomCompositeWorker } from "./worker/sbom-composite-worker";

@Module({
  imports: [SupabaseModule],
  controllers: [
    SbomExportController,
    ProductReleaseSbomController,
    SbomDocumentsController,
    SbomDiffsController,
    SbomUploadsController,
    SbomJobsController,
    SbomSourcesController,
    SbomQualitySettingsController,
    SbomCiController,
    SbomCiCredentialsController,
    ProductReleaseSupplierSbomController,
    SupplierSbomRequestsController,
    SupplierSbomSubmissionsController,
    SupplierSbomPortalController,
    ProductReleaseSbomCompositeController,
    SbomCompositeReviewsController,
  ],
  providers: [
    SupabaseSbomExportRepository,
    {
      provide: SBOM_EXPORT_REPOSITORY,
      useExisting: SupabaseSbomExportRepository,
    },
    {
      provide: SbomExportUseCases,
      inject: [SBOM_EXPORT_REPOSITORY],
      useFactory: (repository: SupabaseSbomExportRepository) =>
        new SbomExportUseCases(repository),
    },
    SupabaseSbomStorageAdapter,
    {
      provide: SupabaseBsiEvidenceAdapter,
      inject: [SupabaseService, SupabaseSbomStorageAdapter],
      useFactory: (
        supabase: SupabaseService,
        storage: SupabaseSbomStorageAdapter,
      ) =>
        new SupabaseBsiEvidenceAdapter(
          supabase,
          storage,
          extractBsiProfileFacts,
        ),
    },
    SupabaseSbomRepository,
    { provide: SBOM_INTAKE_REPOSITORY, useExisting: SupabaseSbomRepository },
    { provide: SUPPLIER_SBOM_REPOSITORY, useExisting: SupabaseSbomRepository },
    {
      provide: SBOM_NORMALIZATION_REPOSITORY,
      useExisting: SupabaseSbomRepository,
    },
    { provide: SBOM_QUALITY_REPOSITORY, useExisting: SupabaseSbomRepository },
    { provide: SBOM_DIFF_REPOSITORY, useExisting: SupabaseSbomRepository },
    {
      provide: SBOM_COMPOSITE_REPOSITORY,
      useExisting: SupabaseSbomRepository,
    },
    { provide: SBOM_CI_CREDENTIALS, useExisting: SupabaseSbomRepository },
    {
      provide: SbomIntakeUseCases,
      inject: [SBOM_INTAKE_REPOSITORY, SupabaseSbomStorageAdapter],
      useFactory: (
        repository: SupabaseSbomRepository,
        storage: SupabaseSbomStorageAdapter,
      ) => new SbomIntakeUseCases(repository, storage),
    },
    {
      provide: SupplierSbomUseCases,
      inject: [SUPPLIER_SBOM_REPOSITORY, SupabaseSbomStorageAdapter],
      useFactory: (
        repository: SupabaseSbomRepository,
        storage: SupabaseSbomStorageAdapter,
      ) => new SupplierSbomUseCases(repository, storage),
    },
    {
      provide: SbomNormalizationUseCases,
      inject: [SBOM_NORMALIZATION_REPOSITORY],
      useFactory: (repository: SupabaseSbomRepository) =>
        new SbomNormalizationUseCases(repository),
    },
    {
      provide: SbomQualityUseCases,
      inject: [SBOM_QUALITY_REPOSITORY],
      useFactory: (repository: SupabaseSbomRepository) =>
        new SbomQualityUseCases(repository),
    },
    {
      provide: SbomDiffUseCases,
      inject: [SBOM_DIFF_REPOSITORY],
      useFactory: (repository: SupabaseSbomRepository) =>
        new SbomDiffUseCases(repository),
    },
    {
      provide: SbomCompositeUseCases,
      inject: [SBOM_COMPOSITE_REPOSITORY],
      useFactory: (repository: SupabaseSbomRepository) =>
        new SbomCompositeUseCases(repository),
    },
    SbomService,
    SupplierSbomService,
    SbomCiCredentialGuard,
    {
      provide: SbomIngestWorker,
      inject: [
        SupabaseSbomRepository,
        SupabaseSbomStorageAdapter,
        ConfigService,
      ],
      useFactory: (
        queue: SupabaseSbomRepository,
        storage: SupabaseSbomStorageAdapter,
        config: ConfigService,
      ) =>
        new SbomIngestWorker({
          workerId: randomUUID(),
          leaseSeconds: 60,
          queue,
          storage,
          validate: validateSbomInWorker,
          maximumBytes: config.getOrThrow<number>(
            "SBOM_NORMALIZATION_MAX_BYTES",
          ),
          maximumComponents: config.getOrThrow<number>(
            "SBOM_NORMALIZATION_MAX_COMPONENTS",
          ),
        }),
    },
    {
      provide: SbomQualityWorker,
      inject: [
        SupabaseSbomRepository,
        ConfigService,
        SupabaseBsiEvidenceAdapter,
      ],
      useFactory: (
        queue: SupabaseSbomRepository,
        config: ConfigService,
        bsiEvidenceReader: SupabaseBsiEvidenceAdapter,
      ) =>
        new SbomQualityWorker({
          workerId: randomUUID(),
          leaseSeconds: 60,
          queue,
          bsiEvidenceReader,
          pageSize: config.get<number>("SBOM_QUALITY_PAGE_SIZE") ?? 1_000,
          maximumComponents:
            config.get<number>("SBOM_NORMALIZATION_MAX_COMPONENTS") ?? 50_000,
        }),
    },
    {
      provide: SbomDiffWorker,
      inject: [SupabaseSbomRepository, ConfigService],
      useFactory: (queue: SupabaseSbomRepository, config: ConfigService) =>
        new SbomDiffWorker({
          workerId: randomUUID(),
          leaseSeconds: 60,
          queue,
          pageSize: config.get<number>("SBOM_DIFF_PAGE_SIZE") ?? 1_000,
          batchSize: config.get<number>("SBOM_DIFF_BATCH_SIZE") ?? 250,
          versionComparator: createM4SbomDiffVersionComparator(),
        }),
    },
    {
      provide: SbomCompositeWorker,
      inject: [
        SupabaseSbomRepository,
        SbomIntakeUseCases,
        SupabaseSbomStorageAdapter,
      ],
      useFactory: (
        queue: SupabaseSbomRepository,
        intake: SbomIntakeUseCases,
        storage: SupabaseSbomStorageAdapter,
      ) =>
        new SbomCompositeWorker({
          workerId: randomUUID(),
          leaseSeconds: 60,
          queue,
          intake,
          storage,
        }),
    },
  ],
  exports: [
    SupplierSbomService,
    SbomIngestWorker,
    SbomQualityWorker,
    SbomDiffWorker,
    SbomCompositeWorker,
  ],
})
export class SbomModule {}
