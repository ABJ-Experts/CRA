"use client";

import type { OrganizationExport } from "@repo/contracts";
import { Button } from "@repo/ui/button";
import { useState } from "react";

import {
  useDownloadOrganizationExportMutation,
  useLatestOrganizationExportQuery,
  useOrganizationExportQuery,
  useRequestExportMutation,
} from "../../_features/organizations/organizations.queries";
import { ErrorText, messageFor, ReadonlyNotice } from "./organization-administration-ui";
import { SectionCard } from "../_components/dashboard-chrome";
import { formatOrganizationInstant } from "./organization-administration-ui";

function labelize(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function makeIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function OrganizationExportSection({
  canExport,
  organizationTimezone,
}: {
  canExport: boolean;
  organizationTimezone: string | null;
}) {
  const requestExport = useRequestExportMutation();
  const downloadExport = useDownloadOrganizationExportMutation();
  const [exportId, setExportId] = useState<string | null>(null);
  const [requestedExport, setRequestedExport] =
    useState<OrganizationExport | null>(null);
  const [requestIdempotencyKey, setRequestIdempotencyKey] = useState<
    string | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const latestExport = useLatestOrganizationExportQuery(canExport);
  const latestExportId = latestExport.data?.export?.id ?? null;
  const exportQuery = useOrganizationExportQuery(
    exportId ?? latestExportId,
    canExport,
  );
  const currentExport =
    exportQuery.data?.export ?? requestedExport ?? latestExport.data?.export ?? null;

  async function createExport() {
    setMessage(null);
    const idempotencyKey = requestIdempotencyKey ?? makeIdempotencyKey();
    setRequestIdempotencyKey(idempotencyKey);
    try {
      const response = await requestExport.mutateAsync({
        // Reuse the same key after a failed browser retry so the server can
        // reconcile a request that may already have been persisted.
        idempotencyKey,
      });
      setRequestedExport(response.export);
      setExportId(response.export.id);
      setRequestIdempotencyKey(null);
      setMessage(
        response.idempotent
          ? "Existing export request resumed."
          : "Export request queued.",
      );
    } catch (error) {
      setMessage(messageFor(error, "Export request could not be queued."));
    }
  }

  async function download() {
    if (currentExport === null) return;
    setMessage(null);
    try {
      const response = await downloadExport.mutateAsync(currentExport.id);
      // The server authorizes this short-lived, attachment-only destination.
      window.location.assign(response.url);
    } catch (error) {
      setMessage(messageFor(error, "Export download could not be prepared."));
    }
  }

  return (
    <SectionCard title="Full tenant export" className="h-full" bodyClassName="flex">
      <div className="flex flex-1 flex-col gap-4">
        {!canExport ? (
          <ReadonlyNotice>
            Only organization owners with export permission can request or
            download tenant exports.
          </ReadonlyNotice>
        ) : null}
        <p className="text-subhead-regular text-fg-muted">
          Exports are generated asynchronously from tenant-scoped records and
          artifact snapshots. Secret material is excluded by the server.
        </p>
        {currentExport ? (
          <div className="rounded-xl bg-surface-subtle p-4" aria-live="polite">
            <p className="text-subhead-semibold text-fg">
              Status: {labelize(currentExport.status)}
            </p>
            <p className="text-caption-1-regular text-fg-muted">
              Progress: {currentExport.progress.completedParts}/
              {currentExport.progress.totalParts} parts
            </p>
            {currentExport.manifest ? (
              <p className="text-caption-1-regular text-fg-muted">
                Manifest: {currentExport.manifest.fileCount} files, verified {" "}
                {formatOrganizationInstant(
                  currentExport.manifest.verifiedAt,
                  organizationTimezone,
                )}
              </p>
            ) : null}
            {currentExport.error ? (
              <p role="alert" className="text-caption-1-regular text-danger">
                {currentExport.error.message}
              </p>
            ) : null}
          </div>
        ) : null}
        {exportQuery.isPending && exportId ? (
          <p role="status" className="text-caption-1-regular text-fg-muted">
            Checking export progress…
          </p>
        ) : null}
        {exportQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-caption-1-regular text-danger">
              Export progress could not be loaded.
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void exportQuery.refetch()}
            >
              Retry export status
            </Button>
          </div>
        ) : null}
        {latestExport.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-caption-1-regular text-danger">
              Existing export progress could not be loaded.
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void latestExport.refetch()}
            >
              Retry existing export
            </Button>
          </div>
        ) : null}
        <ErrorText>{message}</ErrorText>
        <div className="mt-auto flex flex-wrap gap-3 pt-1">
          {canExport ? (
            <Button
              type="button"
              onClick={() => void createExport()}
              loading={requestExport.isPending}
              loadingLabel="Requesting export"
            >
              Request export
            </Button>
          ) : null}
          {currentExport?.status === "completed" && canExport ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void download()}
              loading={downloadExport.isPending}
              loadingLabel="Preparing export download"
            >
              Download export
            </Button>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
