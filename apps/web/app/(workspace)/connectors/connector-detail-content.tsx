"use client";

import { Button } from "@repo/ui/button";
import { useState } from "react";
import {
  productFieldAuthorityFieldSchema,
  releaseFieldAuthorityFieldSchema,
} from "../../_features/connectors/connectors.schemas";
import type { FieldAuthorityPolicy } from "../../_features/connectors/connectors.schemas";

import {
  useConnectorMappingQuery,
  useConnectorQuery,
  useExportDiagnosticsMutation,
} from "../../_features/connectors/connectors.queries";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  PageHeading,
  SectionCard,
} from "../../dashboard/_components/dashboard-chrome";

import { ConnectorConnectionSection } from "./connector-connection-section";
import { ConnectorMappingSection } from "./connector-mapping-section";
import { ConnectorSyncRunSection } from "./connector-sync-run-section";
import { ConnectorConflictsSection } from "./connector-conflicts-section";
import { ConnectorDeadLettersSection } from "./connector-dead-letters-section";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 404)
    return "This connector is unavailable.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  return fallback;
}

function downloadDiagnostics(
  filename: string,
  report: Readonly<Record<string, unknown>>,
): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** The synchronization engine refuses implicit field ownership. Keep the
 * operational UI on the same all-fields gate so it cannot imply a one-policy
 * mapping is ready for a durable pull. */
export function isMappingIncomplete(
  policies: readonly FieldAuthorityPolicy[],
): boolean {
  const configured = new Set(
    policies.map((policy) => `${policy.entityType}:${policy.fieldName}`),
  );
  return [
    ...productFieldAuthorityFieldSchema.options.map((field) =>
      `product:${field}`,
    ),
    ...releaseFieldAuthorityFieldSchema.options.map((field) =>
      `release:${field}`,
    ),
  ].some((required) => !configured.has(required));
}

/** Deliverable 7: diagnostics export button, kept on the detail page. */
export function DiagnosticsExportButton({
  connectorId,
}: {
  connectorId: string;
}) {
  const exportDiagnostics = useExportDiagnosticsMutation(connectorId);
  const [message, setMessage] = useState<string | null>(null);

  async function runExport() {
    setMessage(null);
    try {
      const response = await exportDiagnostics.mutateAsync();
      downloadDiagnostics(response.filename, response.report);
    } catch (error) {
      setMessage(errorMessage(error, "The diagnostics export failed."));
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        variant="outline"
        tone="grey"
        onClick={() => void runExport()}
        loading={exportDiagnostics.isPending}
        loadingLabel="Preparing diagnostics export"
      >
        Export diagnostics
      </Button>
      {message ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function ConnectorDetailContent({
  connectorId,
}: {
  connectorId: string;
}) {
  const mocksReady = useMocksReady();
  const {
    session,
    permissions,
    role,
    isLoading: sessionLoading,
  } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  const canView = permissions.can_view_connectors === true;
  const enabled = liveApiEnabled && hasMembership && canView;
  const connector = useConnectorQuery(connectorId, enabled);
  const mapping = useConnectorMappingQuery(connectorId, enabled);
  const canEdit = permissions.can_edit_connectors === true;
  const canCreate = permissions.can_create_connectors === true;
  const canApprove = permissions.can_approve_connectors === true;
  const canExport = permissions.can_export_connectors === true;
  const isOwner = role === "owner";
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const policies = mapping.data?.policies ?? [];

  if (!liveApiEnabled || !hasMembership || sessionLoading) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            {sessionLoading
              ? "Loading connector…"
              : "Connectors are available when the live backend is enabled."}
          </p>
        </SectionCard>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
        <SectionCard>
          <p role="alert" className="text-subhead-regular text-danger">
            You do not have permission to view this connector.
          </p>
        </SectionCard>
      </div>
    );
  }

  if (connector.isPending) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading connector…
          </p>
        </SectionCard>
      </div>
    );
  }

  if (connector.isError || !connector.data) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
        <SectionCard>
          <p role="alert" className="text-subhead-regular text-danger">
            {errorMessage(
              connector.error,
              "This connector could not be loaded.",
            )}
          </p>
        </SectionCard>
      </div>
    );
  }

  const current = connector.data.connector;

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title={current.displayName}
        subtitle={`${current.connectorType} · adapter ${current.adapterVersion}`}
        actions={
          canExport ? (
            <DiagnosticsExportButton connectorId={connectorId} />
          ) : undefined
        }
      />
      <ConnectorConnectionSection
        connector={current}
        canEdit={canEdit}
        isOwner={isOwner}
        onReload={() => void connector.refetch()}
      />
      <ConnectorMappingSection
        connectorId={connectorId}
        policies={policies}
        canEdit={canEdit}
        isOwner={isOwner}
      />
      <ConnectorSyncRunSection
        connectorId={connectorId}
        canView={canView}
        canStart={canCreate}
        canManage={canEdit}
        canApprove={canApprove}
        mappingIncomplete={isMappingIncomplete(policies)}
        onSelectRun={setSelectedRunId}
      />
      <ConnectorConflictsSection
        connectorId={connectorId}
        runId={selectedRunId}
        canView={canView}
        canApprove={canApprove}
      />
      <ConnectorDeadLettersSection
        connectorId={connectorId}
        canView={canView}
        canEdit={canEdit}
      />
    </div>
  );
}
