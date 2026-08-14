"use client";

import { Button } from "@repo/ui/button";
import type { ReactNode } from "react";

import {
  useCurrentOrganizationQuery,
  useOrganizationLifecycleQuery,
  useOrganizationRetentionQuery,
  useOrganizationSettingsCatalogQuery,
  useOrganizationSettingsQuery,
  useLegalEntitiesQuery,
  useOrganizationBrandingPreviewQuery,
  useOrganizationBrandingQuery,
} from "../../_features/organizations/organizations.queries";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import { PageHeading, SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { OrganizationExportSection } from "./organization-export-section";
import { OrganizationBrandingSection } from "./organization-branding-section";
import { OrganizationLegalEntitiesSection } from "./organization-legal-entities-section";
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

function labelize(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function OrganizationWorkspaceSummary({
  name,
  slug,
  settingsStatus,
  legalEntityCount,
  lifecycleStatus,
}: {
  name: string;
  slug: string;
  settingsStatus: "configured" | "unconfigured";
  legalEntityCount: number;
  lifecycleStatus: string;
}) {
  return (
    <section
      aria-label="Organization workspace"
      className="grid gap-5 rounded-2xl bg-surface-subtle p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)]"
    >
      <div className="min-w-0">
        <h2 className="break-words text-h6 text-fg">{name}</h2>
        <p className="mt-2 max-w-4xl text-subhead-regular text-fg-muted">
          Server-owned tenant configuration, legal identity, and data-lifecycle
          controls. Browser locale, local storage, and deployment region never
          select operational policy.
        </p>
        <p className="mt-3 break-all text-caption-1-regular text-fg-muted">
          Organization identifier: {slug}
        </p>
      </div>
      <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-caption-1-regular text-fg-muted">Settings</dt>
          <dd className="mt-1 text-subhead-semibold text-fg">
            {settingsStatus === "configured" ? "Configured" : "Needs setup"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption-1-regular text-fg-muted">
            Legal entities
          </dt>
          <dd className="mt-1 text-subhead-semibold text-fg">
            {legalEntityCount} recorded
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption-1-regular text-fg-muted">
            Tenant lifecycle
          </dt>
          <dd className="mt-1 text-subhead-semibold text-fg">
            {labelize(lifecycleStatus)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function OrganizationAdministrationGroup({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-4 max-w-4xl">
        <h2 id={id} className="text-h6 text-fg">
          {title}
        </h2>
        <p className="mt-1 text-subhead-regular text-fg-muted">{description}</p>
      </div>
      {children}
    </section>
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
  const legalEntities = useLegalEntitiesQuery(enabled);
  const branding = useOrganizationBrandingQuery(enabled);
  const brandingPreview = useOrganizationBrandingPreviewQuery(enabled);
  const canView = permissions.can_view_organization === true;
  const canEdit = permissions.can_edit_organization === true;
  const canManageIdentity = role === "owner" && canEdit;
  // Presentation only. The API independently enforces owner and permission.
  const canExport =
    role === "owner" && permissions.can_export_organization === true;
  const canDelete =
    role === "owner" && permissions.can_delete_organization === true;

  const loading =
    isLoading ||
    current.isPending ||
    settings.isPending ||
    catalog.isPending ||
    retention.isPending ||
    lifecycle.isPending ||
    legalEntities.isPending ||
    branding.isPending ||
    brandingPreview.isPending;
  const firstError =
    current.error ??
    settings.error ??
    catalog.error ??
    retention.error ??
    lifecycle.error ??
    legalEntities.error ??
    branding.error ??
    brandingPreview.error ??
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
              legalEntities.refetch(),
              branding.refetch(),
              brandingPreview.refetch(),
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
        lifecycle.data &&
        legalEntities.data &&
        branding.data &&
        brandingPreview.data ? (
        <>
          <OrganizationWorkspaceSummary
            name={current.data.organization.name}
            slug={current.data.organization.slug}
            settingsStatus={settings.data.settings.status}
            legalEntityCount={legalEntities.data.legalEntities.length}
            lifecycleStatus={lifecycle.data.lifecycle.status}
          />
          <div className="flex flex-col gap-10">
            <OrganizationAdministrationGroup
              id="organization-configuration"
              title="Organization configuration"
              description="Set the tenant-wide operational policy before teams create or maintain regulated product records."
            >
              <div className="flex flex-col gap-5">
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
                <div className="grid gap-5 2xl:grid-cols-2">
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
                </div>
              </div>
            </OrganizationAdministrationGroup>
            <OrganizationAdministrationGroup
              id="organization-identity"
              title="Identity and presentation"
              description="Maintain the legal manufacturer identity and the organization branding shown throughout the workspace."
              className="border-t border-border pt-8"
            >
              <div className="flex flex-col gap-5">
                <OrganizationLegalEntitiesSection
                  key={`legal-entities-${current.data.organization.id}`}
                  legalEntities={legalEntities.data.legalEntities}
                  canManage={canManageIdentity}
                  onRefresh={() => void legalEntities.refetch()}
                />
                <OrganizationBrandingSection
                  key={`branding-${current.data.organization.id}`}
                  resolvedBranding={branding.data.branding}
                  draftPreview={brandingPreview.data.branding}
                  canManage={canManageIdentity}
                  organizationTimezone={organizationTimezone}
                  onRefresh={() => {
                    void Promise.all([
                      branding.refetch(),
                      brandingPreview.refetch(),
                    ]);
                  }}
                />
              </div>
            </OrganizationAdministrationGroup>
            <OrganizationAdministrationGroup
              id="organization-lifecycle"
              title="Tenant lifecycle"
              description="Review the protected deactivation, recovery, and deletion controls for this tenant."
              className="border-t border-border pt-8"
            >
              <OrganizationLifecycleSection
                key={`lifecycle-${current.data.organization.id}`}
                lifecycle={lifecycle.data.lifecycle}
                slug={current.data.organization.slug}
                canDelete={canDelete}
                organizationTimezone={organizationTimezone}
              />
            </OrganizationAdministrationGroup>
          </div>
        </>
      ) : null}
    </div>
  );
}
