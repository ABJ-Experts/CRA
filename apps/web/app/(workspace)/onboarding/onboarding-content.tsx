"use client";

import { Button } from "@repo/ui/button";
import { Select, SelectItem } from "@repo/ui/select";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateOrganizationMutation,
  useCurrentOrganizationQuery,
  useOnboardingQuery,
  useSwitchOrganizationMutation,
  useUpdateLegalProfileMutation,
} from "../../_features/organizations/organizations.queries";
import { InvitationManager } from "./invitation-manager";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import { PageHeading, SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { OnboardingProgress } from "./onboarding-progress";
import { OrganizationProfileForm } from "./organization-profile-form";

function isForbidden(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.kind === "api" &&
    error.status === 403
  );
}

function retryMessage(error: unknown): string {
  if (isForbidden(error)) {
    return "You do not have access to organization onboarding.";
  }
  return "We could not load organization onboarding. Please try again.";
}

function RetryState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <SectionCard>
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="text-subhead-regular text-danger">
          {retryMessage(error)}
        </p>
        <Button type="button" variant="outline" tone="grey" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </SectionCard>
  );
}

export function OnboardingContent() {
  const mocksReady = useMocksReady();
  const {
    session,
    isError: sessionIsError,
    isLoading: sessionIsLoading,
    permissions = {},
  } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  /* A user with no memberships cannot hold can_view_organization. Avoid
     requesting the permission-bound current endpoint before showing create. */
  const currentQuery = useCurrentOrganizationQuery(
    liveApiEnabled && hasMembership,
  );
  const activeOrganization = currentQuery.data?.organization ?? null;
  const onboardingQuery = useOnboardingQuery(
    liveApiEnabled && activeOrganization !== null,
  );
  const createOrganization = useCreateOrganizationMutation();
  const switchOrganization = useSwitchOrganizationMutation();
  const updateLegalProfile = useUpdateLegalProfileMutation();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const canEditOrganization = permissions.can_edit_organization === true;

  async function switchActiveOrganization(organizationId: string) {
    setSwitchError(null);
    try {
      await switchOrganization.mutateAsync(organizationId);
    } catch (error) {
      setSwitchError(
        error instanceof ApiClientError && error.kind === "api"
          ? error.message
          : "We could not switch organizations.",
      );
    }
  }

  const organizations = session?.organizations ?? [];

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title="Organization onboarding"
        subtitle="Your progress is confirmed by the server and resumes across devices."
      />

      {!liveApiEnabled ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Organization onboarding is available when the live backend is
            enabled.
          </p>
        </SectionCard>
      ) : sessionIsLoading || (hasMembership && currentQuery.isPending) ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading organization setup…
          </p>
        </SectionCard>
      ) : sessionIsError ? (
        <RetryState
          error={new Error("session")}
          onRetry={() => location.reload()}
        />
      ) : currentQuery.isError ? (
        <RetryState
          error={currentQuery.error}
          onRetry={() => void currentQuery.refetch()}
        />
      ) : !hasMembership || activeOrganization === null ? (
        <SectionCard title="Create your legal organization profile">
          <p className="mb-6 text-subhead-regular text-fg-muted">
            We use this information to identify the organization that
            manufactures your products. You can correct profile details later.
          </p>
          <OrganizationProfileForm
            mode="create"
            isCreating={createOrganization.isPending}
            onCreate={(input) => createOrganization.mutateAsync(input)}
          />
        </SectionCard>
      ) : onboardingQuery.isPending ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading server-confirmed onboarding progress…
          </p>
        </SectionCard>
      ) : onboardingQuery.isError ? (
        <RetryState
          error={onboardingQuery.error}
          onRetry={() => void onboardingQuery.refetch()}
        />
      ) : onboardingQuery.data ? (
        <SectionCard
          title={activeOrganization.name}
          action={
            organizations.length > 1 ? (
              <Select
                aria-label="Current organization"
                value={activeOrganization.id}
                onValueChange={(organizationId) =>
                  void switchActiveOrganization(organizationId)
                }
                disabled={switchOrganization.isPending}
              >
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>
                    {organization.name}
                  </SelectItem>
                ))}
              </Select>
            ) : null
          }
        >
          {switchError ? (
            <p
              role="status"
              className="mb-4 text-caption-1-regular text-danger"
            >
              {switchError}
            </p>
          ) : null}
          {canEditOrganization &&
          (isEditingProfile || activeOrganization.legalProfile === null) ? (
            <div className="flex flex-col gap-4">
              <p className="text-subhead-regular text-fg-muted">
                Complete or correct the legal profile used to identify this
                manufacturer.
              </p>
              <OrganizationProfileForm
                mode="edit"
                profile={activeOrganization.legalProfile}
                isUpdating={updateLegalProfile.isPending}
                onCancel={() => setIsEditingProfile(false)}
                onUpdate={async (input) => {
                  await updateLegalProfile.mutateAsync(input);
                  setIsEditingProfile(false);
                }}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {canEditOrganization ? (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => setIsEditingProfile(true)}
                  >
                    Edit legal profile
                  </Button>
                </div>
              ) : null}
              <OnboardingProgress progress={onboardingQuery.data} />
              {onboardingQuery.data.integrationAvailability.invitations ? (
                <InvitationManager
                  canView={permissions.can_view_invitations === true}
                  canCreate={permissions.can_create_invitations === true}
                  canDelete={permissions.can_delete_invitations === true}
                />
              ) : null}
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}
