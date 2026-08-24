import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { SupabaseModule } from "../supabase/supabase.module";
import { SBOM_CI_CREDENTIALS } from "./application/sbom-ci-credential.port";
import {
  SBOM_INTAKE_REPOSITORY,
  SbomIntakeUseCases,
} from "./application/sbom-intake-use-cases";
import {
  SBOM_NORMALIZATION_REPOSITORY,
  SbomNormalizationUseCases,
} from "./application/sbom-normalization-use-cases";
import { SupabaseSbomRepository } from "./infrastructure/supabase-sbom.repository";
import { SupabaseSbomStorageAdapter } from "./infrastructure/supabase-sbom-storage.adapter";
import { SbomCiCredentialsController } from "./sbom-ci-credentials.controller";
import { SbomCiCredentialGuard } from "./sbom-ci-credential.guard";
import {
  ProductReleaseSbomController,
  SbomCiController,
  SbomDocumentsController,
  SbomJobsController,
  SbomSourcesController,
  SbomUploadsController,
} from "./sbom.controller";
import { SbomService } from "./sbom.service";
import { validateSbomInWorker } from "./validation/sbom-validation-worker";
import { SbomIngestWorker } from "./worker/sbom-ingest-worker";

@Module({
  imports: [SupabaseModule],
  controllers: [
    ProductReleaseSbomController,
    SbomDocumentsController,
    SbomUploadsController,
    SbomJobsController,
    SbomSourcesController,
    SbomCiController,
    SbomCiCredentialsController,
  ],
  providers: [
    SupabaseSbomStorageAdapter,
    SupabaseSbomRepository,
    { provide: SBOM_INTAKE_REPOSITORY, useExisting: SupabaseSbomRepository },
    {
      provide: SBOM_NORMALIZATION_REPOSITORY,
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
      provide: SbomNormalizationUseCases,
      inject: [SBOM_NORMALIZATION_REPOSITORY],
      useFactory: (repository: SupabaseSbomRepository) =>
        new SbomNormalizationUseCases(repository),
    },
    SbomService,
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
  ],
  exports: [SbomIngestWorker],
})
export class SbomModule {}
