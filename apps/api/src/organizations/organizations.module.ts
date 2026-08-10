import { Module } from "@nestjs/common";

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

@Module({
  imports: [SupabaseModule],
  controllers: [OrganizationsController],
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
    {
      provide: OnboardingEvidenceRecorder,
      useExisting: SupabaseOnboardingEvidenceRecorder,
    },
  ],
  exports: [OrganizationsService, OnboardingEvidenceRecorder],
})
export class OrganizationsModule {}
