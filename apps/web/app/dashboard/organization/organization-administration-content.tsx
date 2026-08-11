"use client";

import { Button } from "@repo/ui/button";

import {
  useCurrentOrganizationQuery,
  useOrganizationLifecycleQuery,
  useOrganizationRetentionQuery,
  useOrganizationSettingsCatalogQuery,
  useOrganizationSettingsQuery,
} from "../../_features/organizations/organizations.queries";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import { PageHeading, SectionCard } from "../_components/dashboard-chrome";
import { OrganizationExportSection } from "./organization-export-section";
import { OrganizationLifecycleSection } from "./organization-lifecycle-section";
import {
  administrationLoadError,
  ReadonlyNotice,
} from "./organization-administration-ui";
import {
  OrganizationRetentionSection,
  OrganizationSettingsSection,
} from "./organization-settings-retention";

function LoadingCard({ label }: { label: string }) {
  return (
    <SectionCard>
      <p role="status" className="text-subhead-regular text-fg-muted">
        {label}
      </p>
    </SectionCard>
  );
}

function RetryCard({
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
          {administrationLoadError(error)}
        </p>
        <Button type="button" variant="outline" tone="grey" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </SectionCard>
  );
}

export function OrganizationAdministrationContent() {
  const mocksReady = useMocksReady();
  const { session, permissions = {}, role, isLoading, isError } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  const enabled = liveApiEnabled && hasMembership;
  const current = useCurrentOrganizationQuery(enabled);
  const settings = useOrganizationSettingsQuery(enabled);
  const catalog = useOrganizationSettingsCatalogQuery(enabled);
  const retention = useOrganizationRetentionQuery(enabled);
  const lifecycle = useOrganizationLifecycleQuery(enabled);
  const canView = permissions.can_view_organization === true;
  const canEdit = permissions.can_edit_organization === true;
  // Presentation only. The API independently enforces owner and permission.
  const canExport = role === "owner" && permissions.can_export_organization === true;
  const canDelete = role === "owner" && permissions.can_delete_organization === true;

  const loading =
    isLoading ||
    current.isPending ||
    settings.isPending ||
    catalog.isPending ||
    retention.isPending ||
    lifecycle.isPending;
  const firstError =
    current.error ??
    settings.error ??
    catalog.error ??
    retention.error ??
    lifecycle.error ??
    (isError ? new Error("session") : null);
  const failed = firstError !== null;
  const organizationTimezone =
    settings.data?.settings.status === "configured"
      ? settings.data.settings.values.timezone
      : null;

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title="Organization administration"
        subtitle="Settings, retention, export, and tenant data lifecycle controls."
      />
      {!liveApiEnabled ? (
        <ReadonlyNotice>
          Organization administration is available when the live backend is
          enabled.
        </ReadonlyNotice>
      ) : !hasMembership ? (
        <ReadonlyNotice>
          Create or join an organization before managing tenant settings.
        </ReadonlyNotice>
      ) : loading ? (
        <LoadingCard label="Loading organization administration…" />
      ) : failed ? (
        <RetryCard
          error={firstError}
          onRetry={() => {
            void Promise.all([
              current.refetch(),
              settings.refetch(),
              catalog.refetch(),
              retention.refetch(),
              lifecycle.refetch(),
            ]);
          }}
        />
      ) : !canView ? (
        <ReadonlyNotice>
          You do not have permission to view organization administration.
        </ReadonlyNotice>
      ) : current.data?.organization &&
        settings.data &&
        catalog.data &&
        retention.data &&
        lifecycle.data ? (
        <>
          <SectionCard title={current.data.organization.name}>
            <p className="text-subhead-regular text-fg-muted">
              Settings are shown as stored server state. Browser locale, local
              storage, and deployment region do not select timezone, AI
              provider, retention, export, or residency behavior.
            </p>
          </SectionCard>
          <OrganizationSettingsSection
            key={`settings-${current.data.organization.id}`}
            catalog={catalog.data.catalog}
            values={
              settings.data.settings.status === "configured"
                ? settings.data.settings.values
                : null
            }
            version={settings.data.settings.version}
            readiness={settings.data.mfaRolloutReadiness}
            canEdit={canEdit}
            onRefresh={() => {
              void Promise.all([settings.refetch(), catalog.refetch()]);
            }}
          />
          <OrganizationRetentionSection
            key={`retention-${current.data.organization.id}`}
            policies={retention.data.policies}
            canEdit={canEdit}
            onRefresh={() => void retention.refetch()}
          />
          <OrganizationExportSection
            key={`exports-${current.data.organization.id}`}
            canExport={canExport}
            organizationTimezone={organizationTimezone}
          />
          <OrganizationLifecycleSection
            key={`lifecycle-${current.data.organization.id}`}
            lifecycle={lifecycle.data.lifecycle}
            slug={current.data.organization.slug}
            canDelete={canDelete}
            organizationTimezone={organizationTimezone}
          />
        </>
      ) : null}
    </div>
  );
}
