"use client";

import { Button } from "@repo/ui/button";
import Link from "next/link";

import { useOnboardingQuery } from "../../_features/organizations/organizations.queries";
import { useMocksReady } from "../../_providers/providers";
import {
  useHasPermission,
  useSession,
} from "../../_providers/session-provider";

const STAGE_LABELS = {
  organization_details: "Organization details",
  first_product: "First product",
  first_sbom: "First SBOM",
  invite_team: "Invite the team",
  completed: "Complete onboarding",
} as const;

/** A non-authoritative dashboard prompt for server-confirmed incomplete work. */
export function DashboardOnboardingResume() {
  const mocksReady = useMocksReady();
  const { session } = useSession();
  const canViewOrganization = useHasPermission("can_view_organization");
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const enabled =
    liveApiEnabled &&
    session?.organization !== null &&
    session?.organization !== undefined &&
    canViewOrganization;
  const onboarding = useOnboardingQuery(enabled);

  if (
    !enabled ||
    !onboarding.data ||
    onboarding.isError ||
    onboarding.data.nextIncompleteStage === null
  ) {
    return null;
  }

  const stage = onboarding.data.nextIncompleteStage;
  return (
    <section
      aria-label="Organization onboarding"
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface-raised px-5 py-4"
    >
      <div>
        <p className="text-subhead-semibold text-fg">
          Continue organization onboarding
        </p>
        <p className="text-caption-1-regular text-fg-muted">
          Next required action: {STAGE_LABELS[stage]}.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/onboarding">Resume onboarding</Link>
      </Button>
    </section>
  );
}
