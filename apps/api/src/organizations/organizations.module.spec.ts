import { MODULE_METADATA } from "@nestjs/common/constants";

import { OnboardingEvidenceRecorder } from "./application/onboarding-evidence-recorder.port";
import {
  LEGAL_ENTITY_DEPENDENCY_REPORTER,
  LEGAL_ENTITY_DIRECTORY,
} from "./legal-entities/application/legal-entity-ports";
import { LegalEntityUseCases } from "./legal-entities/application/legal-entity-use-cases";
import { SupabaseLegalEntityRepository } from "./legal-entities/infrastructure/supabase-legal-entity.repository";
import { LegalEntitiesController } from "./legal-entities/legal-entities.controller";
import { LegalEntitiesService } from "./legal-entities/legal-entities.service";
import { SupabaseOnboardingEvidenceRecorder } from "./infrastructure/supabase-onboarding-evidence-recorder.adapter";
import { OrganizationsModule } from "./organizations.module";
import { OrganizationsService } from "./organizations.service";

describe("OrganizationsModule", () => {
  it("exports the facade and one-way onboarding evidence port", () => {
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      OrganizationsModule,
    ) as readonly unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      OrganizationsModule,
    ) as readonly unknown[];

    expect(exports).toContain(OrganizationsService);
    expect(exports).toContain(OnboardingEvidenceRecorder);
    expect(providers).toContain(SupabaseOnboardingEvidenceRecorder);
  });

  it("wires legal-entity administration plus the one-way integration ports", () => {
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      OrganizationsModule,
    ) as readonly unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      OrganizationsModule,
    ) as readonly unknown[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      OrganizationsModule,
    ) as readonly unknown[];

    expect(controllers).toContain(LegalEntitiesController);
    expect(providers).toContain(SupabaseLegalEntityRepository);
    expect(providers).toContain(LegalEntitiesService);
    expect(
      providers.some(
        (provider) =>
          typeof provider === "object" &&
          provider !== null &&
          "provide" in provider &&
          provider.provide === LegalEntityUseCases,
      ),
    ).toBe(true);
    expect(exports).toContain(LEGAL_ENTITY_DIRECTORY);
    expect(exports).toContain(LEGAL_ENTITY_DEPENDENCY_REPORTER);
  });
});
