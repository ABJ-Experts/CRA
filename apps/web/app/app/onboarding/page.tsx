import { redirect } from "next/navigation";
import { PageHeading, SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { apiGet, type OrganisationData, type PrincipalData } from "../_lib/api";
import { OnboardingFlow } from "./onboarding-flow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const [{ data: organisation, error }, { data: principal }] = await Promise.all([
    apiGet<OrganisationData>("/organisations/current"),
    apiGet<PrincipalData>("/identity/current"),
  ]);
  if (organisation?.onboardingState?.step === "sbom_uploaded") redirect("/app/dashboard");
  return (
    <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
      <PageHeading
        title="Set up CRA Sentinel"
        subtitle="Complete the first product and SBOM to begin continuous vulnerability monitoring."
      />
      <SectionCard>
        {error || !organisation ? (
          <p role="alert" className="text-danger-fg">
            {error ?? "Could not load onboarding."}
          </p>
        ) : (
          <OnboardingFlow organisation={organisation} principal={principal ?? null} />
        )}
      </SectionCard>
    </div>
  );
}
