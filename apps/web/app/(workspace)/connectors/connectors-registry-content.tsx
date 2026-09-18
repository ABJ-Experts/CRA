"use client";

import { createConnectorInputSchema } from "../../_features/connectors/connectors.schemas";
import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  useConnectorsQuery,
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

import {
  CONNECTOR_CARD_STATUS_LABEL,
  CONNECTOR_CARD_STATUS_TONE,
  deriveConnectorCardStatus,
} from "./connector-status";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network") {
    return "We could not reach the connector registry.";
  }
  return fallback;
}

function ConnectorCreateForm({
  onCreated,
}: {
  onCreated: (connector: Connector) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [adapterVersion, setAdapterVersion] = useState("");
  const [mappingVersion, setMappingVersion] = useState("");
  const [commitPolicy, setCommitPolicy] = useState<"manual" | "auto">("manual");
  const [connectionConfigJson, setConnectionConfigJson] = useState("{}");
  const [message, setMessage] = useState<string | null>(null);
  const create = useCreateConnectorMutation();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    let connectionConfig: Record<string, unknown>;
    try {
      connectionConfig = JSON.parse(connectionConfigJson) as Record<
        string,
        unknown
      >;
    } catch {
      setMessage("Connection config must be valid JSON.");
      return;
    }
    const parsed = createConnectorInputSchema.safeParse({
      connectorType: "reference_conformance",
      displayName,
      adapterVersion,
      mappingVersion,
      connectionConfig,
      commitPolicy,
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
          Display name
          <input
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
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
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Adapter version
          <input
            required
            value={adapterVersion}
            onChange={(event) => setAdapterVersion(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Mapping version
          <input
            required
            value={mappingVersion}
            onChange={(event) => setMappingVersion(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2">
          Connection config (JSON, no secrets)
          <textarea
            value={connectionConfigJson}
            onChange={(event) => setConnectionConfigJson(event.target.value)}
            className="min-h-28 rounded-xl border border-border bg-canvas px-3 py-2 font-mono text-caption-1-regular text-fg"
          />
        </label>
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

function ConnectorStatusBadge({ connector }: { connector: Connector }) {
  const status = deriveConnectorCardStatus(connector);
  const tone = CONNECTOR_CARD_STATUS_TONE[status];
  return (
    <Tag variant={tone ? "fill" : "cool"} tone={tone} size="sm">
      {CONNECTOR_CARD_STATUS_LABEL[status]}
    </Tag>
  );
}

function ConnectorCard({
  connector,
  onOpen,
}: {
  connector: Connector;
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
          <ConnectorStatusBadge connector={connector} />
        </div>
        <p className="text-caption-1-regular text-fg-muted">
          Adapter {connector.adapterVersion} · Mapping{" "}
          {connector.mappingVersion} ·{" "}
          {connector.commitPolicy === "auto" ? "Auto commit" : "Manual commit"}
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
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  const canView = permissions.can_view_connectors === true;
  const canCreate = permissions.can_create_connectors === true;
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const connectors = useConnectorsQuery(
    { page: 1, pageSize: 25, q: search.trim() || undefined },
    liveApiEnabled && hasMembership && canView,
  );
  const connectorCount = connectors.data?.connectors.total ?? 0;
  const countLabel = `${connectorCount} ${connectorCount === 1 ? "connector" : "connectors"} configured`;

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title="Connectors"
        subtitle="PLM/ALM connectors syncing product and release structure into this organization."
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
          {showCreate ? (
            <ConnectorCreateForm
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
                onChange={(event) => setSearch(event.target.value)}
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
                {connectors.data?.connectors.rows.map((connector) => (
                  <ConnectorCard
                    key={connector.id}
                    connector={connector}
                    onOpen={(id) => router.push(`/connectors/${id}`)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
