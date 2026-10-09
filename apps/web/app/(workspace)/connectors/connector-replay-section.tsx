"use client";
import { useState } from "react";
import { Button } from "@repo/ui/button";
import type { ReplaySyncRunPreview } from "@repo/contracts/connectors/types";
import {
  useSyncDetailQuery,
  usePreviewReplayMutation,
  useReplayMutation,
} from "../../_features/connectors/sync-operations.queries";
import { operationError, OperationMessage } from "./connector-operation-ui";
export function ConnectorReplaySection({
  connectorId,
  runId,
  canEdit,
}: {
  connectorId: string;
  runId: string;
  canEdit: boolean;
}) {
  const detail = useSyncDetailQuery(
    connectorId,
    runId,
    { page: 1, pageSize: 1 },
    canEdit,
  );
  const previewAction = usePreviewReplayMutation(connectorId, runId);
  const replay = useReplayMutation(connectorId, runId);
  const [mappingMode, setMappingMode] = useState<"preserve" | "rebase">(
    "preserve",
  );
  const [sourceMode, setSourceMode] = useState<"retained" | "refetch">(
    "retained",
  );
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ReplaySyncRunPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = previewAction.isPending || replay.isPending;
  const version = detail.data?.run.version;
  const fresh = preview?.runVersion === version;
  async function previewReplay() {
    if (version === undefined) return;
    setMessage(null);
    setPreview(null);
    try {
      setPreview(
        (
          await previewAction.mutateAsync({
            expectedVersion: version,
            mappingMode,
            sourceMode,
          })
        ).preview,
      );
    } catch (error) {
      setMessage(operationError(error, "Replay preview could not be loaded."));
    }
  }
  async function requestReplay() {
    if (!preview?.canReplay || !fresh || !reason.trim()) return;
    setMessage(null);
    try {
      const response = await replay.mutateAsync({
        expectedVersion: preview.runVersion,
        mappingMode,
        sourceMode,
        previewDigest: preview.previewDigest,
        idempotencyKey: crypto.randomUUID(),
        reason: reason.trim(),
      });
      setPreview(null);
      setMessage(
        `Reviewed dry run created: ${response.run.id}. Review it before requesting commit.`,
      );
    } catch (error) {
      setPreview(null);
      setMessage(operationError(error, "Replay could not be requested."));
    }
  }
  if (!canEdit)
    return (
      <OperationMessage alert>
        You do not have permission to replay this batch.
      </OperationMessage>
    );
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-headline-semibold text-fg">Reviewed replay</h3>
      <p className="text-subhead-regular text-fg-muted">
        The whole batch stays blocked until every required record can apply.
        Replay creates a child dry run; the failed parent remains in history.
      </p>
      {detail.isPending ? (
        <OperationMessage>Loading replay version…</OperationMessage>
      ) : detail.isError ? (
        <>
          <OperationMessage alert>
            Current replay version could not be loaded.
          </OperationMessage>
          <Button
            variant="outline"
            tone="grey"
            onClick={() => void detail.refetch()}
          >
            Reload replay version
          </Button>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Mapping version
              <select
                value={mappingMode}
                disabled={pending}
                onChange={(event) => {
                  setMappingMode(event.target.value as "preserve" | "rebase");
                  setPreview(null);
                }}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              >
                <option value="preserve">Preserve original mapping</option>
                <option value="rebase">Rebase onto current mapping</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
              Source records
              <select
                value={sourceMode}
                disabled={pending}
                onChange={(event) => {
                  setSourceMode(event.target.value as "retained" | "refetch");
                  setPreview(null);
                }}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              >
                <option value="retained">Use retained records</option>
                <option value="refetch">Refetch from provider</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2">
              Replay reason
              <textarea
                maxLength={500}
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
                className="min-h-20 rounded-xl border border-border bg-canvas p-3 text-subhead-regular text-fg"
              />
            </label>
          </div>
          {sourceMode === "refetch" ? (
            <OperationMessage>
              Refetch reads current provider records and always requires a new
              review before commit.
            </OperationMessage>
          ) : null}
          {preview ? (
            <div aria-live="polite">
              <OperationMessage alert={!preview.canReplay || !fresh}>
                {fresh
                  ? `${preview.recordCount} records · field map revision ${preview.mappingRevision} · ${preview.canReplay ? "Ready for reviewed replay" : "Replay blocked"}`
                  : "The run changed. Preview replay again."}
              </OperationMessage>
              {preview.issues.map((issue, index) => (
                <p key={index} className="text-caption-1-regular text-danger">
                  {issue.message}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              tone="grey"
              disabled={pending || version === undefined}
              onClick={() => void previewReplay()}
              loading={previewAction.isPending}
              loadingLabel="Previewing replay"
            >
              Preview replay
            </Button>
            <Button
              disabled={
                pending || !preview?.canReplay || !fresh || !reason.trim()
              }
              onClick={() => void requestReplay()}
              loading={replay.isPending}
              loadingLabel="Requesting reviewed replay"
            >
              Request reviewed replay
            </Button>
          </div>
        </>
      )}
      {message ? (
        <OperationMessage alert={!message.startsWith("Reviewed dry run")}>
          {message}
        </OperationMessage>
      ) : null}
    </div>
  );
}
