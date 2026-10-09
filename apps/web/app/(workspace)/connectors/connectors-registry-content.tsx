"use client";
import type {
  ConnectorConnectionState,
  ConnectorType,
} from "@repo/contracts/connectors/types";
import { ConnectorCatalogueSection } from "./connector-catalogue-section";

import { createConnectorInputSchema } from "../../_features/connectors/connectors.schemas";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Tag } from "@repo/ui/tag";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import {
  useConnectorCatalogueQuery,
  useConnectorOverviewsQuery,
  useCreateConnectorMutation,
} from "../../_features/connectors/connectors.queries";
import type { Connector } from "../../_features/connectors/connectors.schemas";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  PageHeading,
  SectionCard,
} from "../../dashboard/_components/dashboard-chrome";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network") {
    return "We could not reach the connector registry.";
  }
  return fallback;
}

function ConnectorCreateForm({
  initialType,
  onCreated,
}: {
  initialType: ConnectorType;
  onCreated: (connector: Connector) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [connectorType, setConnectorType] =
    useState<ConnectorType>(initialType);
  const [adapterVersion, setAdapterVersion] = useState("1.0.0");
  const [mappingVersion, setMappingVersion] = useState(
    initialType === "on_prem_agent" ? "on-prem-agent-v1" : "v1",
  );
  const [commitPolicy, setCommitPolicy] = useState<"manual" | "auto">("manual");
  const [connectionConfigJson, setConnectionConfigJson] = useState("{}");
  const [providerHost, setProviderHost] = useState("gitlab.com");
  const [appId, setAppId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [organization, setOrganization] = useState("");
  const [serviceConnectionId, setServiceConnectionId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const create = useCreateConnectorMutation();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    let connectionConfig: Record<string, unknown>;
    if (connectorType === "reference_conformance") {
      try {
        connectionConfig = JSON.parse(connectionConfigJson) as Record<
          string,
          unknown
        >;
      } catch {
        setMessage("Connection config must be valid JSON.");
        return;
      }
    } else if (connectorType === "on_prem_agent") {
      connectionConfig = {};
    } else if (connectorType === "github_actions") {
      connectionConfig = { providerHost: "github.com", appId, installationId };
    } else if (connectorType === "gitlab_ci") {
      connectionConfig = { providerHost, projectId };
    } else {
      connectionConfig = {
        providerHost: "dev.azure.com",
        organization,
        projectId,
        serviceConnectionId,
      };
    }
    const parsed = createConnectorInputSchema.safeParse({
      connectorType,
      displayName,
      adapterVersion,
      mappingVersion,
      connectionConfig,
      commitPolicy:
        connectorType === "reference_conformance" ? commitPolicy : "manual",
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the connector details.",
      );
      return;
    }
    try {
      const response = await create.mutateAsync(parsed.data);
      onCreated(response.connector);
    } catch (error) {
      setMessage(errorMessage(error, "The connector could not be created."));
    }
  }

  return (
    <SectionCard title="Add connector">
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Connector type
          <select
            aria-label="Connector type"
            value={connectorType}
            onChange={(event) => {
              setConnectorType(event.target.value as ConnectorType);
              setCommitPolicy("manual");
              setAdapterVersion("1.0.0");
              setMappingVersion(
                event.target.value === "on_prem_agent"
                  ? "on-prem-agent-v1"
                  : "v1",
              );
            }}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-active-500"
          >
            <option value="reference_conformance">Reference adapter</option>
            <option value="on_prem_agent">On-premises agent</option>
            <option value="github_actions">GitHub Actions App</option>
            <option value="gitlab_ci">GitLab CI project</option>
            <option value="azure_devops">Azure DevOps pipeline</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Display name
          <input
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        {connectorType === "reference_conformance" ? (
          <label
            className="flex flex-col gap-2 text-caption-1-regular text-fg"
            htmlFor="connector-commit-policy"
          >
            Commit policy
            <select
              id="connector-commit-policy"
              value={commitPolicy}
              onChange={(event) =>
                setCommitPolicy(event.target.value as "manual" | "auto")
              }
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            >
              <option value="manual">Manual commit</option>
              <option value="auto">Auto commit</option>
            </select>
          </label>
        ) : null}
        {connectorType === "on_prem_agent" ? (
          <p className="text-caption-1-regular text-fg-muted sm:col-span-2">
            The agent reads approved internal sources and connects outbound to
            CRA. Create this connector, then enroll a Linux service or container
            on its detail page. Internal source credentials stay on that host.
          </p>
        ) : null}
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Adapter version
          <input
            required
            value={adapterVersion}
            onChange={(event) => setAdapterVersion(event.target.value)}
            readOnly={connectorType === "on_prem_agent"}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Mapping version
          <input
            required
            value={mappingVersion}
            onChange={(event) => setMappingVersion(event.target.value)}
            readOnly={connectorType === "on_prem_agent"}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        {connectorType === "reference_conformance" ? (
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2">
            Connection config (JSON, no secrets)
            <textarea
              value={connectionConfigJson}
              onChange={(event) => setConnectionConfigJson(event.target.value)}
              className="min-h-28 rounded-xl border border-border bg-canvas px-3 py-2 font-mono text-caption-1-regular text-fg"
            />
          </label>
        ) : null}
        {connectorType === "github_actions" ? (
          <>
            <p
              className={cn(
                "text-caption-1-regular text-fg-muted sm:col-span-2",
              )}
            >
              Install the GitHub App only on the intended repositories. Grant
              Actions: read for run verification and Contents: read for release
              tag verification. Manual workflow_dispatch runs are unsupported.
            </p>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              GitHub App ID
              <input
                aria-label="GitHub App ID"
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-active-500"
              />
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              GitHub installation ID
              <input
                aria-label="GitHub installation ID"
                value={installationId}
                onChange={(event) => setInstallationId(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-active-500"
              />
            </label>
          </>
        ) : null}
        {connectorType === "gitlab_ci" ? (
          <>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              GitLab host
              <input
                aria-label="GitLab host"
                value={providerHost}
                onChange={(event) => setProviderHost(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-active-500"
              />
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              GitLab project ID
              <input
                aria-label="GitLab project ID"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-active-500"
              />
            </label>
          </>
        ) : null}
        {connectorType === "azure_devops" ? (
          <>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Azure organization
              <input
                aria-label="Azure organization"
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-active-500"
              />
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Azure project ID
              <input
                aria-label="Azure project ID"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-active-500"
              />
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Service connection ID
              <input
                aria-label="Service connection ID"
                value={serviceConnectionId}
                onChange={(event) => setServiceConnectionId(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-active-500"
              />
            </label>
          </>
        ) : null}
        {connectorType !== "reference_conformance" &&
        connectorType !== "on_prem_agent" ? (
          <p className="text-caption-1-regular text-fg-muted sm:col-span-2">
            Save the provider credential in this connector&apos;s Secret section
            after creation. The configuration above contains no credential.
          </p>
        ) : null}
        {message ? (
          <p
            role="alert"
            className="sm:col-span-2 text-subhead-regular text-danger"
          >
            {message}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <Button
            type="submit"
            loading={create.isPending}
            loadingLabel="Creating connector"
          >
            Add connector
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ConnectorStatusBadge({
  connection,
}: {
  connection: ConnectorConnectionState;
}) {
  const tone =
    connection.status === "healthy"
      ? "green"
      : connection.status === "auth_expired"
        ? "red"
        : undefined;
  return (
    <Tag variant={tone ? "fill" : "cool"} tone={tone} size="sm">
      {connection.status.replaceAll("_", " ")}
    </Tag>
  );
}

function ConnectorCard({
  connector,
  connection,
  onOpen,
}: {
  connector: Connector;
  connection: ConnectorConnectionState;
  onOpen: (id: string) => void;
}) {
  return (
    <li className="flex flex-col gap-4 border-b border-border py-5 first:pt-1 last:border-b-0 last:pb-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-headline-semibold text-fg">
            {connector.displayName}
          </p>
          <Tag variant="cool" size="sm">
            {connector.connectorType}
          </Tag>
          <ConnectorStatusBadge connection={connection} />
        </div>
        <p className="text-caption-1-regular text-fg-muted">
          Adapter {connector.adapterVersion} · Mapping{" "}
          {connector.mappingVersion} ·{" "}
          {connector.commitPolicy === "auto" ? "Auto commit" : "Manual commit"}
        </p>
        <p className="text-caption-1-regular text-fg">
          {connector.connectorType === "on_prem_agent"
            ? "On-premises source · Last sync: "
            : connector.connectorType === "reference_conformance"
              ? "Reference fixture validation only · Last sync: "
              : "Provider integration · Last sync: "}
          {connection.lastSyncAt
            ? new Date(connection.lastSyncAt).toLocaleString()
            : "Never"}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        tone="grey"
        endIcon={<ArrowUpRight aria-hidden="true" />}
        aria-label={`Open connector ${connector.displayName}`}
        onClick={() => onOpen(connector.id)}
      >
        Open
      </Button>
    </li>
  );
}

/** Deliverable 1: connector list/dashboard. Mirrors `ProductsRegistryContent`. */
export function ConnectorsRegistryContent() {
  const router = useRouter();
  const mocksReady = useMocksReady();
  const { session, permissions, isLoading: sessionLoading } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = Boolean(session?.organization?.id);
  const canView = permissions.can_view_connectors === true;
  const canCreate = permissions.can_create_connectors === true;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<ConnectorType>(
    "reference_conformance",
  );
  const catalogue = useConnectorCatalogueQuery(
    liveApiEnabled && hasMembership && canView,
  );
  const connectors = useConnectorOverviewsQuery(
    { page, pageSize: 25, q: search.trim() || undefined },
    liveApiEnabled && hasMembership && canView,
  );
  const connectorCount = connectors.data?.connectors.total ?? 0;
  const countLabel = `${connectorCount} ${connectorCount === 1 ? "connector" : "connectors"} configured`;

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title="Connectors"
        subtitle="Integration availability, configuration and safe connection diagnostics for this organization."
        actions={
          canCreate ? (
            <Button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
            >
              {showCreate ? "Close form" : "Add connector"}
            </Button>
          ) : undefined
        }
      />
      {canView ? (
        <div className={cn("flex flex-wrap gap-4")}>
          <Link
            href="/connectors/webhooks"
            className={cn(
              "text-subhead-regular text-fg underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-active-500",
            )}
          >
            Outbound webhooks
          </Link>
          <Link
            href="/connectors/ci"
            className={cn(
              "text-subhead-regular text-fg underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-active-500",
            )}
          >
            CI SBOM bindings
          </Link>
        </div>
      ) : null}
      {!liveApiEnabled ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Connectors are available when the live backend is enabled.
          </p>
        </SectionCard>
      ) : !hasMembership ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Create or join an organization before managing connectors.
          </p>
        </SectionCard>
      ) : sessionLoading ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading connectors…
          </p>
        </SectionCard>
      ) : !canView ? (
        <SectionCard>
          <p role="alert" className="text-subhead-regular text-danger">
            You do not have permission to view connectors.
          </p>
        </SectionCard>
      ) : (
        <>
          {catalogue.isPending ? (
            <SectionCard>
              <p role="status" className="text-subhead-regular text-fg">
                Loading integration catalogue…
              </p>
            </SectionCard>
          ) : catalogue.isError ? (
            <SectionCard>
              <div role="alert" className="space-y-3">
                <p className="text-subhead-regular text-danger">
                  {errorMessage(
                    catalogue.error,
                    "The integration catalogue could not be loaded.",
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void catalogue.refetch()}
                >
                  Retry catalogue
                </Button>
              </div>
            </SectionCard>
          ) : (
            <ConnectorCatalogueSection
              entries={catalogue.data?.catalogue ?? []}
              canCreate={canCreate}
              onConfigure={(type) => {
                setCreateType(type);
                setShowCreate(true);
              }}
            />
          )}
          {showCreate ? (
            <ConnectorCreateForm
              key={`${session?.organization?.id}:${createType}`}
              initialType={createType}
              onCreated={(connector) => {
                setShowCreate(false);
                router.push(`/connectors/${connector.id}`);
              }}
            />
          ) : null}
          <SectionCard
            title="Connector registry"
            action={
              <p
                aria-live="polite"
                className="text-caption-1-semibold tabular-nums text-fg"
              >
                {connectors.isPending ? "Loading registry…" : countLabel}
              </p>
            }
          >
            <div className="mb-6 border-b border-border pb-5">
              <input
                type="search"
                aria-label="Search connectors"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search by name"
                className="h-10 w-full max-w-xl rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              />
            </div>
            {connectors.isPending ? (
              <p role="status" className="text-subhead-regular text-fg-muted">
                Loading connectors…
              </p>
            ) : connectors.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3">
                <p className="text-subhead-regular text-danger">
                  {errorMessage(
                    connectors.error,
                    "Connectors could not be loaded.",
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void connectors.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : connectors.data?.connectors.rows.length === 0 ? (
              <p className="text-subhead-regular text-fg-muted">
                {search
                  ? "No connectors match this search."
                  : "No connectors have been configured yet."}
              </p>
            ) : (
              <ul aria-label="Connectors">
                {connectors.data?.connectors.rows.map(
                  ({ connector, connection }) => (
                    <ConnectorCard
                      key={connector.id}
                      connector={connector}
                      connection={connection}
                      onOpen={(id) => router.push(`/connectors/${id}`)}
                    />
                  ),
                )}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                tone="grey"
                disabled={page <= 1 || connectors.isPending}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous page
              </Button>
              <p className="text-caption-1-regular text-fg">Page {page}</p>
              <Button
                type="button"
                variant="outline"
                tone="grey"
                disabled={
                  page >= (connectors.data?.connectors.pageCount ?? 1) ||
                  connectors.isPending
                }
                onClick={() => setPage((value) => value + 1)}
              >
                Next page
              </Button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
