"use client";

import { Button } from "@repo/ui/button";
import {
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalRoot,
  ModalTitle,
  type ModalSize,
} from "@repo/ui/modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import {
  Building2,
  Settings2,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

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
import { ApiClientError } from "../../_lib/http/api-client";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import {
  PageHeading,
  SectionCard,
} from "../../dashboard/_components/dashboard-chrome";
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

function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403;
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
  legalEntityCount: number | null;
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
            {legalEntityCount === null
              ? "Unavailable"
              : `${legalEntityCount} recorded`}
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

type OrganizationWorkbenchPanel = "settings" | "identity" | "lifecycle";
type OrganizationWorkbenchTab =
  | "settings"
  | "retention"
  | "export"
  | "legal-entities"
  | "branding"
  | "lifecycle";

type OrganizationWorkbenchItem = Readonly<{
  id: OrganizationWorkbenchPanel;
  title: string;
  description: string;
  icon: LucideIcon;
}>;

const ORGANIZATION_WORKBENCH_ITEMS = Object.freeze([
  {
    id: "settings",
    title: "Organization settings",
    description: "Set operational policy, retention, and exports.",
    icon: Settings2,
  },
  {
    id: "identity",
    title: "Organization identity",
    description: "Manage legal entities and workspace branding.",
    icon: Building2,
  },
  {
    id: "lifecycle",
    title: "Tenant lifecycle",
    description: "Review protected deactivation and recovery controls.",
    icon: ShieldAlert,
  },
] satisfies readonly OrganizationWorkbenchItem[]);

const ORGANIZATION_WORKBENCH_TABS = Object.freeze({
  settings: [
    { value: "settings", label: "Settings" },
    { value: "retention", label: "Evidence retention" },
    { value: "export", label: "Exports" },
  ],
  identity: [
    { value: "legal-entities", label: "Legal entities" },
    { value: "branding", label: "Branding" },
  ],
  lifecycle: [{ value: "lifecycle", label: "Lifecycle" }],
} as const satisfies Record<
  OrganizationWorkbenchPanel,
  readonly { value: OrganizationWorkbenchTab; label: string }[]
>);

const ORGANIZATION_WORKBENCH_MODAL_SIZES = Object.freeze({
  settings: "xl",
  identity: "xl",
  lifecycle: "lg",
} as const satisfies Record<OrganizationWorkbenchPanel, ModalSize>);

function OrganizationWorkbench({
  onOpen,
}: Readonly<{
  onOpen: (
    panel: OrganizationWorkbenchPanel,
    opener: HTMLButtonElement,
  ) => void;
}>) {
  return (
    <SectionCard title="Organization workbench">
      <p className="max-w-3xl text-subhead-regular text-fg-muted">
        Open one focused workspace at a time. Tenant policy and audit-backed
        controls remain available while you work.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ORGANIZATION_WORKBENCH_ITEMS.map((item) => {
          const Icon = item.icon;
          const descriptionId = `organization-workbench-${item.id}-description`;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.title}
              aria-describedby={descriptionId}
              aria-haspopup="dialog"
              className="group flex min-h-28 flex-col items-start rounded-xl border border-border bg-canvas p-4 text-left transition-colors duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none"
              onClick={(event) => onOpen(item.id, event.currentTarget)}
            >
              <Icon
                aria-hidden="true"
                className="size-5 text-fg-muted transition-colors duration-150 group-hover:text-fg motion-reduce:transition-none"
              />
              <span className="mt-4 text-subhead-semibold text-fg">
                {item.title}
              </span>
              <span
                id={descriptionId}
                className="mt-1 text-caption-1-regular text-fg-muted"
              >
                {item.description}
              </span>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

function OrganizationWorkbenchDialog({
  panel,
  tab,
  onTabChange,
  onClose,
  children,
}: Readonly<{
  panel: OrganizationWorkbenchPanel;
  tab: OrganizationWorkbenchTab;
  onTabChange: (tab: OrganizationWorkbenchTab) => void;
  onClose: () => void;
  children: ReactNode;
}>) {
  const item = ORGANIZATION_WORKBENCH_ITEMS.find(
    (candidate) => candidate.id === panel,
  );
  if (!item) return null;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as OrganizationWorkbenchTab)}
    >
      <ModalRoot
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalContent
          size={ORGANIZATION_WORKBENCH_MODAL_SIZES[panel]}
          aria-label={item.title}
        >
          <ModalHeader className="items-start pr-16">
            <ModalTitle>{item.title}</ModalTitle>
            <ModalDescription>{item.description}</ModalDescription>
            <TabsList
              aria-label={`${item.title} sections`}
              className="mt-2 w-full"
            >
              {ORGANIZATION_WORKBENCH_TABS[panel].map((itemTab) => (
                <TabsTrigger
                  key={itemTab.value}
                  value={itemTab.value}
                  onClick={() => onTabChange(itemTab.value)}
                >
                  {itemTab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </ModalHeader>
          <ModalBody className="pb-6">{children}</ModalBody>
        </ModalContent>
      </ModalRoot>
    </Tabs>
  );
}

export function OrganizationAdministrationContent() {
  const mocksReady = useMocksReady();
  const { session, permissions = {}, role, isLoading, isError } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  const canView = permissions.can_view_organization === true;
  const enabled = liveApiEnabled && hasMembership && canView;
  const current = useCurrentOrganizationQuery(enabled);
  const settings = useOrganizationSettingsQuery(enabled);
  const catalog = useOrganizationSettingsCatalogQuery(enabled);
  const retention = useOrganizationRetentionQuery(enabled);
  const lifecycle = useOrganizationLifecycleQuery(enabled);
  const legalEntities = useLegalEntitiesQuery(enabled);
  const branding = useOrganizationBrandingQuery(enabled);
  const brandingPreview = useOrganizationBrandingPreviewQuery(enabled);
  const canEdit = permissions.can_edit_organization === true;
  const canManageIdentity = role === "owner" && canEdit;
  // Presentation only. The API independently enforces owner and permission.
  const canExport =
    role === "owner" && permissions.can_export_organization === true;
  const canDelete =
    role === "owner" && permissions.can_delete_organization === true;
  const [activePanel, setActivePanel] =
    useState<OrganizationWorkbenchPanel | null>(null);
  const [activeTab, setActiveTab] =
    useState<OrganizationWorkbenchTab>("settings");
  const lastWorkbenchOpenerRef = useRef<HTMLButtonElement | null>(null);

  function openWorkbench(
    panel: OrganizationWorkbenchPanel,
    opener: HTMLButtonElement,
  ) {
    lastWorkbenchOpenerRef.current = opener;
    setActivePanel(panel);
    setActiveTab(ORGANIZATION_WORKBENCH_TABS[panel][0].value);
  }

  function closeWorkbench() {
    setActivePanel(null);
    window.setTimeout(() => lastWorkbenchOpenerRef.current?.focus(), 0);
  }

  const loading =
    isLoading ||
    (enabled &&
      (current.isPending || settings.isPending || lifecycle.isPending));
  const secondaryAccessError = [
    catalog.error,
    retention.error,
    legalEntities.error,
    branding.error,
    brandingPreview.error,
  ].find(isForbiddenError);
  const firstError =
    (enabled
      ? (current.error ??
        settings.error ??
        lifecycle.error ??
        secondaryAccessError)
      : null) ?? (isError ? new Error("session") : null);
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
      ) : current.data?.organization && settings.data && lifecycle.data ? (
        <>
          <OrganizationWorkspaceSummary
            name={current.data.organization.name}
            slug={current.data.organization.slug}
            settingsStatus={settings.data.settings.status}
            legalEntityCount={legalEntities.data?.legalEntities.length ?? null}
            lifecycleStatus={lifecycle.data.lifecycle.status}
          />
          <OrganizationWorkbench onOpen={openWorkbench} />
          {activePanel ? (
            <OrganizationWorkbenchDialog
              panel={activePanel}
              tab={activeTab}
              onTabChange={setActiveTab}
              onClose={closeWorkbench}
            >
              {activePanel === "settings" ? (
                <>
                  <TabsContent value="settings" forceMount className="min-w-0">
                    {catalog.data ? (
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
                          void Promise.all([
                            settings.refetch(),
                            catalog.refetch(),
                          ]);
                        }}
                      />
                    ) : (
                      <RetryCard
                        error={catalog.error}
                        onRetry={() => void catalog.refetch()}
                      />
                    )}
                  </TabsContent>
                  <TabsContent value="retention" forceMount className="min-w-0">
                    {retention.data ? (
                      <OrganizationRetentionSection
                        key={`retention-${current.data.organization.id}`}
                        policies={retention.data.policies}
                        canEdit={canEdit}
                        onRefresh={() => void retention.refetch()}
                      />
                    ) : (
                      <RetryCard
                        error={retention.error}
                        onRetry={() => void retention.refetch()}
                      />
                    )}
                  </TabsContent>
                  <TabsContent value="export" forceMount className="min-w-0">
                    <OrganizationExportSection
                      key={`exports-${current.data.organization.id}`}
                      canExport={canExport}
                      organizationTimezone={organizationTimezone}
                    />
                  </TabsContent>
                </>
              ) : null}
              {activePanel === "identity" ? (
                <>
                  <TabsContent
                    value="legal-entities"
                    forceMount
                    className="min-w-0"
                  >
                    {legalEntities.data ? (
                      <OrganizationLegalEntitiesSection
                        key={`legal-entities-${current.data.organization.id}`}
                        legalEntities={legalEntities.data.legalEntities}
                        canManage={canManageIdentity}
                        onRefresh={() => void legalEntities.refetch()}
                      />
                    ) : (
                      <RetryCard
                        error={legalEntities.error}
                        onRetry={() => void legalEntities.refetch()}
                      />
                    )}
                  </TabsContent>
                  <TabsContent value="branding" forceMount className="min-w-0">
                    {branding.data && brandingPreview.data ? (
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
                    ) : (
                      <RetryCard
                        error={branding.error ?? brandingPreview.error}
                        onRetry={() => {
                          void Promise.all([
                            branding.refetch(),
                            brandingPreview.refetch(),
                          ]);
                        }}
                      />
                    )}
                  </TabsContent>
                </>
              ) : null}
              {activePanel === "lifecycle" ? (
                <TabsContent value="lifecycle" forceMount className="min-w-0">
                  <OrganizationLifecycleSection
                    key={`lifecycle-${current.data.organization.id}`}
                    lifecycle={lifecycle.data.lifecycle}
                    slug={current.data.organization.slug}
                    canDelete={canDelete}
                    organizationTimezone={organizationTimezone}
                  />
                </TabsContent>
              ) : null}
            </OrganizationWorkbenchDialog>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
