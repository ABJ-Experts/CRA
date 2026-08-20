import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";

import { SupabaseModule } from "../supabase/supabase.module";
import { SBOM_CI_CREDENTIALS } from "./application/sbom-ci-credential.port";
import {
  SBOM_INTAKE_REPOSITORY,
  SbomIntakeUseCases,
} from "./application/sbom-intake-use-cases";
import { SupabaseSbomRepository } from "./infrastructure/supabase-sbom.repository";
import { SupabaseSbomStorageAdapter } from "./infrastructure/supabase-sbom-storage.adapter";
import { SbomCiCredentialsController } from "./sbom-ci-credentials.controller";
import { SbomCiCredentialGuard } from "./sbom-ci-credential.guard";
import {
  ProductReleaseSbomController,
  SbomCiController,
  SbomJobsController,
  SbomSourcesController,
  SbomUploadsController,
} from "./sbom.controller";
import { SbomService } from "./sbom.service";
import { SbomIngestWorker } from "./worker/sbom-ingest-worker";

@Module({
  imports: [SupabaseModule],
  controllers: [
    ProductReleaseSbomController,
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
    { provide: SBOM_CI_CREDENTIALS, useExisting: SupabaseSbomRepository },
    {
      provide: SbomIntakeUseCases,
      inject: [SBOM_INTAKE_REPOSITORY, SupabaseSbomStorageAdapter],
      useFactory: (
        repository: SupabaseSbomRepository,
        storage: SupabaseSbomStorageAdapter,
      ) => new SbomIntakeUseCases(repository, storage),
    },
    SbomService,
    SbomCiCredentialGuard,
    {
      provide: SbomIngestWorker,
      inject: [SupabaseSbomRepository, SupabaseSbomStorageAdapter],
      useFactory: (
        queue: SupabaseSbomRepository,
        storage: SupabaseSbomStorageAdapter,
      ) =>
        new SbomIngestWorker({
          workerId: randomUUID(),
          leaseSeconds: 60,
          queue,
          storage,
        }),
    },
  ],
  exports: [SbomIngestWorker],
})
export class SbomModule {}
