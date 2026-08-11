import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { AuthModule } from "../auth/auth.module";
import { SupabaseModule } from "../supabase/supabase.module";
import { OnboardingEvidenceRecorder } from "./application/onboarding-evidence-recorder.port";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "./application/organization-repository.port";
import { OrganizationUseCases } from "./application/organization-use-cases";
import { SupabaseOnboardingEvidenceRecorder } from "./infrastructure/supabase-onboarding-evidence-recorder.adapter";
import { SupabaseOrganizationRepository } from "./infrastructure/supabase-organization.repository";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";
import {
  DESTRUCTIVE_REAUTHENTICATION_PORT,
  MFA_FACTOR_READINESS_PORT,
  TENANT_ADMINISTRATION_REPOSITORY,
  TENANT_CLOCK_PORT,
  TENANT_EXPORT_DOWNLOAD_PORT,
  TENANT_REQUEST_IDENTITY_PORT,
  TenantAdministrationUseCases,
  type DestructiveReauthenticationPort,
  type MfaFactorReadinessPort,
  type TenantAdministrationRepository,
  type TenantClockPort,
  type TenantExportDownloadPort,
  type TenantRequestIdentityPort,
} from "./tenant-administration/application/tenant-administration-use-cases";
import {
  ExistingAuthDestructiveReauthenticationAdapter,
  NodeTenantRequestIdentityAdapter,
  SupabaseMfaFactorReadinessAdapter,
  SupabaseTenantExportDownloadAdapter,
  SystemTenantClockAdapter,
} from "./tenant-administration/infrastructure/tenant-administration-adapters";
import { SupabaseTenantAdministrationRepository } from "./tenant-administration/infrastructure/supabase-tenant-administration.repository";
import {
  SupabaseTenantExportSourceAdapter,
  SupabaseTenantLifecycleStorageAdapter,
  SupabaseTenantLifecycleWorkerRepository,
  UnavailableEvidenceCleanupAdapter,
  UnavailableTenantExportArtifactSnapshotAdapter,
} from "./tenant-administration/worker/supabase-tenant-lifecycle-worker.adapter";
import { TenantLifecycleWorker } from "./tenant-administration/worker/tenant-lifecycle-worker";
import { TenantAdministrationController } from "./tenant-administration/tenant-administration.controller";
import { TenantAdministrationService } from "./tenant-administration/tenant-administration.service";

@Module({
  imports: [SupabaseModule, AuthModule],
  controllers: [OrganizationsController, TenantAdministrationController],
  providers: [
    SupabaseOrganizationRepository,
    SupabaseOnboardingEvidenceRecorder,
    {
      provide: ORGANIZATION_REPOSITORY,
      useExisting: SupabaseOrganizationRepository,
    },
    {
      provide: OrganizationUseCases,
      useFactory: (repository: OrganizationRepository) =>
        new OrganizationUseCases(repository),
      inject: [ORGANIZATION_REPOSITORY],
    },
    OrganizationsService,
    SupabaseTenantAdministrationRepository,
    SupabaseTenantLifecycleWorkerRepository,
    SupabaseTenantLifecycleStorageAdapter,
    SupabaseTenantExportSourceAdapter,
    UnavailableEvidenceCleanupAdapter,
    UnavailableTenantExportArtifactSnapshotAdapter,
    SupabaseMfaFactorReadinessAdapter,
    ExistingAuthDestructiveReauthenticationAdapter,
    SupabaseTenantExportDownloadAdapter,
    NodeTenantRequestIdentityAdapter,
    SystemTenantClockAdapter,
    {
      provide: TENANT_ADMINISTRATION_REPOSITORY,
      useExisting: SupabaseTenantAdministrationRepository,
    },
    {
      provide: MFA_FACTOR_READINESS_PORT,
      useExisting: SupabaseMfaFactorReadinessAdapter,
    },
    {
      provide: DESTRUCTIVE_REAUTHENTICATION_PORT,
      useExisting: ExistingAuthDestructiveReauthenticationAdapter,
    },
    {
      provide: TENANT_EXPORT_DOWNLOAD_PORT,
      useExisting: SupabaseTenantExportDownloadAdapter,
    },
    {
      provide: TENANT_REQUEST_IDENTITY_PORT,
      useExisting: NodeTenantRequestIdentityAdapter,
    },
    { provide: TENANT_CLOCK_PORT, useExisting: SystemTenantClockAdapter },
    {
      provide: TenantAdministrationUseCases,
      inject: [
        TENANT_ADMINISTRATION_REPOSITORY,
        MFA_FACTOR_READINESS_PORT,
        DESTRUCTIVE_REAUTHENTICATION_PORT,
        TENANT_EXPORT_DOWNLOAD_PORT,
        TENANT_REQUEST_IDENTITY_PORT,
        TENANT_CLOCK_PORT,
      ],
      useFactory: (
        repository: TenantAdministrationRepository,
        readiness: MfaFactorReadinessPort,
        reauthentication: DestructiveReauthenticationPort,
        downloads: TenantExportDownloadPort,
        requestIdentity: TenantRequestIdentityPort,
        clock: TenantClockPort,
      ) =>
        new TenantAdministrationUseCases(
          repository,
          readiness,
          reauthentication,
          downloads,
          requestIdentity,
          clock,
        ),
    },
    TenantAdministrationService,
    {
      provide: TenantLifecycleWorker,
      inject: [
        SupabaseTenantLifecycleWorkerRepository,
        SupabaseTenantLifecycleStorageAdapter,
        SupabaseTenantExportSourceAdapter,
        UnavailableEvidenceCleanupAdapter,
        UnavailableTenantExportArtifactSnapshotAdapter,
        ConfigService,
      ],
      useFactory: (
        repository: SupabaseTenantLifecycleWorkerRepository,
        storage: SupabaseTenantLifecycleStorageAdapter,
        sources: SupabaseTenantExportSourceAdapter,
        evidenceCleanup: UnavailableEvidenceCleanupAdapter,
        artifactSnapshot: UnavailableTenantExportArtifactSnapshotAdapter,
        config: ConfigService,
      ) =>
        new TenantLifecycleWorker({
          workerId: randomUUID(),
          leaseSeconds: config.getOrThrow<number>(
            "TENANT_LIFECYCLE_LEASE_SECONDS",
          ),
          maximumArchiveBytes: config.getOrThrow<number>(
            "TENANT_EXPORT_MAX_ARCHIVE_BYTES",
          ),
          sources,
          storage,
          export: repository.export,
          cleanup: repository.cleanup,
          purge: repository.purge,
          artifactWork: repository.artifactWork,
          evidenceCleanup,
          artifacts: storage,
          artifactSnapshot,
        }),
    },
    {
      provide: OnboardingEvidenceRecorder,
      useExisting: SupabaseOnboardingEvidenceRecorder,
    },
  ],
  exports: [
    OrganizationsService,
    OnboardingEvidenceRecorder,
    TenantLifecycleWorker,
  ],
})
export class OrganizationsModule {}
