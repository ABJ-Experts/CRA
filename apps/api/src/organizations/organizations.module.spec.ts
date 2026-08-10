import { MODULE_METADATA } from "@nestjs/common/constants";

import { OnboardingEvidenceRecorder } from "./application/onboarding-evidence-recorder.port";
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
});
