"use client";

import { Button } from "@repo/ui/button";
import type {
  TechnicalFileSnapshot,
  TechnicalFileSnapshotExportResponse,
} from "@repo/contracts/technical-files";
import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCancelTechnicalFileSnapshotExportMutation,
  useCreateTechnicalFileSnapshotExportMutation,
  useCreateTechnicalFileSnapshotMutation,
  useTechnicalFileSnapshotDownloadMutation,
  useTechnicalFileSnapshotExportQuery,
  useTechnicalFileSnapshotsQuery,
} from "./technical-files.queries";

function requestId(): string {
  return crypto.randomUUID();
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You no longer have permission to manage technical-file snapshots.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "The technical file changed before the snapshot was captured. Your entered details are still available; refresh and retry.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" || (error.status ?? 0) >= 500)
  ) {
    return "The snapshot service is temporarily unavailable. Your entered details have not been discarded; try again when the connection is restored.";
  }
  return error instanceof ApiClientError ? error.message : fallback;
}

function label(value: string): string {
  return value.replaceAll("_", " ");
}

export function TechnicalFileSnapshots({
  productId,
  technicalFileVersion,
  enabled,
  canView,
  canSnapshot,
}: {
  productId: string;
  technicalFileVersion: number;
  enabled: boolean;
  canView: boolean;
  canSnapshot: boolean;
}) {
  const snapshots = useTechnicalFileSnapshotsQuery(productId, enabled && canView);
  const createSnapshot = useCreateTechnicalFileSnapshotMutation(productId);
  const [purpose, setPurpose] = useState<"audit" | "release">("audit");
  const [releaseId, setReleaseId] = useState("");
  const [auditRationale, setAuditRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [selectedExport, setSelectedExport] = useState<{
    snapshotId: string;
    exportId: string;
  } | null>(null);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (purpose === "audit" && auditRationale.trim() === "") {
      setMessage("Provide an audit rationale before creating this snapshot.");
      return;
    }
    if (purpose === "release" && releaseId.trim() === "") {
      setMessage("Provide the active release ID for a release snapshot.");
      return;
    }
    try {
      await createSnapshot.mutateAsync({
        expectedTechnicalFileVersion: technicalFileVersion,
        purpose,
        ...(purpose === "audit"
          ? { auditRationale: auditRationale.trim() }
          : { releaseId: releaseId.trim() }),
        idempotencyKey: requestId(),
      });
      setMessage("Snapshot captured. Its evidence versions and readiness state are immutable.");
    } catch (error) {
      setMessage(messageFor(error, "The snapshot could not be created."));
    }
  }

  return (
    <section
      aria-labelledby="technical-file-snapshots-heading"
      className="rounded-xl border border-border bg-surface-subtle p-4"
    >
      <div>
        <h2 id="technical-file-snapshots-heading" className="text-h4 text-fg">
          Technical-file snapshots
        </h2>
        <p className="mt-1 text-subhead-regular text-fg-muted">
          Capture an immutable technical-file record for a release or audit. A
          snapshot records pinned evidence and documentation readiness; it does
          not certify compliance.
        </p>
      </div>
      {message ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-subhead-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
      {canSnapshot ? (
        <form onSubmit={create} className="mt-4 grid gap-3" noValidate>
        <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
          Snapshot purpose
          <select
            value={purpose}
            disabled={createSnapshot.isPending}
            onChange={(event) => setPurpose(event.target.value as "audit" | "release")}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="audit">Audit</option>
            <option value="release">Release</option>
          </select>
        </label>
        {purpose === "audit" ? (
          <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
            Audit rationale
            <textarea
              value={auditRationale}
              onChange={(event) => setAuditRationale(event.target.value)}
              disabled={createSnapshot.isPending}
              maxLength={4_000}
              rows={3}
              required
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
            Active release ID
            <input
              value={releaseId}
              onChange={(event) => setReleaseId(event.target.value)}
              disabled={createSnapshot.isPending}
              inputMode="text"
              required
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
        )}
        <div>
          <Button
            type="submit"
            loading={createSnapshot.isPending}
            loadingLabel="Capturing snapshot"
          >
            Create snapshot
          </Button>
        </div>
        </form>
      ) : null}
      {snapshots.isPending ? (
        <p role="status" className="mt-5 text-subhead-regular text-fg-muted">
          Loading snapshots…
        </p>
      ) : snapshots.isError || !snapshots.data ? (
        <div className="mt-5">
          <p className="text-subhead-regular text-fg-muted">
            Snapshot history is temporarily unavailable. No snapshot is treated
            as current while it cannot be read.
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            className="mt-3"
            onClick={() => void snapshots.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : snapshots.data.snapshots.length === 0 ? (
        <p className="mt-5 text-subhead-regular text-fg-muted">
          No snapshots have been captured for this technical file.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3" aria-label="Technical-file snapshots">
          {snapshots.data.snapshots.map((snapshot) => (
            <SnapshotRow
              key={snapshot.id}
              productId={productId}
              snapshot={snapshot}
              canSnapshot={canSnapshot}
              selectedExport={selectedExport}
              onSelectExport={setSelectedExport}
              onMessage={setMessage}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SnapshotRow({
  productId,
  snapshot,
  canSnapshot,
  selectedExport,
  onSelectExport,
  onMessage,
}: {
  productId: string;
  snapshot: TechnicalFileSnapshot;
  canSnapshot: boolean;
  selectedExport: { snapshotId: string; exportId: string } | null;
  onSelectExport: (value: { snapshotId: string; exportId: string }) => void;
  onMessage: (value: string) => void;
}) {
  const createExport = useCreateTechnicalFileSnapshotExportMutation(productId, snapshot.id);
  const current = selectedExport?.snapshotId === snapshot.id ? selectedExport : null;
  const exportStatus = useTechnicalFileSnapshotExportQuery(
    productId,
    current?.snapshotId ?? null,
    current?.exportId ?? null,
    current !== null,
  );

  async function exportSnapshot() {
    try {
      const response = await createExport.mutateAsync({ idempotencyKey: requestId() });
      onSelectExport({ snapshotId: snapshot.id, exportId: response.export.id });
      onMessage("Export generation was queued from the immutable snapshot.");
    } catch (error) {
      onMessage(messageFor(error, "The snapshot export could not be requested."));
    }
  }

  return (
    <li className="rounded-xl border border-border bg-canvas p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-subhead-semibold text-fg">
            {label(snapshot.purpose)} snapshot · {label(snapshot.readinessStatus)} readiness
          </p>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Template {snapshot.templateVersion} · file version {snapshot.technicalFileVersion} · {snapshot.status}
          </p>
          {snapshot.auditRationale ? (
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              {snapshot.auditRationale}
            </p>
          ) : null}
          {snapshot.status === "superseded" ? (
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              Superseded snapshots remain immutable historical records and cannot
              be exported again.
            </p>
          ) : null}
        </div>
        {canSnapshot ? (
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={snapshot.status === "superseded"}
            loading={createExport.isPending}
            loadingLabel="Queuing export"
            onClick={() => void exportSnapshot()}
          >
            Export snapshot
          </Button>
        ) : null}
      </div>
      {current && canSnapshot ? (
        <SnapshotExportStatus
          productId={productId}
          snapshotId={snapshot.id}
          exportId={current.exportId}
          exportStatus={exportStatus}
          onMessage={onMessage}
        />
      ) : null}
    </li>
  );
}

function SnapshotExportStatus({
  productId,
  snapshotId,
  exportId,
  exportStatus,
  onMessage,
}: {
  productId: string;
  snapshotId: string;
  exportId: string;
  exportStatus: UseQueryResult<TechnicalFileSnapshotExportResponse>;
  onMessage: (value: string) => void;
}) {
  const cancel = useCancelTechnicalFileSnapshotExportMutation(productId, snapshotId, exportId);
  const download = useTechnicalFileSnapshotDownloadMutation();
  const [cancelReason, setCancelReason] = useState("");

  async function downloadArtifact(artifact: "pdf" | "archive") {
    try {
      const response = await download.mutateAsync({ productId, snapshotId, exportId, artifact });
      window.open(response.download.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      onMessage(messageFor(error, "The export artifact could not be prepared for download."));
    }
  }

  async function cancelExport() {
    if (cancelReason.trim() === "") {
      onMessage("Provide a cancellation reason before cancelling the export.");
      return;
    }
    try {
      await cancel.mutateAsync({ reason: cancelReason.trim(), idempotencyKey: requestId() });
      onMessage("The export was cancelled with the recorded reason.");
    } catch (error) {
      onMessage(messageFor(error, "The export could not be cancelled."));
    }
  }

  if (exportStatus.isPending) {
    return <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">Loading export status…</p>;
  }
  if (exportStatus.isError || !exportStatus.data) {
    return <p className="mt-3 text-caption-1-regular text-fg-muted">Export status is temporarily unavailable.</p>;
  }
  const current = exportStatus.data.export;
  const canCancel = current.status === "queued" || current.status === "generating";
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-caption-1-semibold text-fg">Export status: {label(current.status)}</p>
      {current.status === "failed" ? <p className="mt-1 text-caption-1-regular text-fg-muted">Failure: {label(current.failureCode ?? "unknown")}</p> : null}
      {current.status === "ready" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" tone="grey" loading={download.isPending} onClick={() => void downloadArtifact("pdf")}>Download PDF</Button>
          <Button type="button" variant="outline" tone="grey" loading={download.isPending} onClick={() => void downloadArtifact("archive")}>Download archive</Button>
        </div>
      ) : null}
      {canCancel ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-caption-1-semibold text-fg">
            Cancellation reason
            <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={1_000} className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" />
          </label>
          <Button type="button" variant="outline" tone="grey" loading={cancel.isPending} onClick={() => void cancelExport()}>Cancel export</Button>
        </div>
      ) : null}
    </div>
  );
}
