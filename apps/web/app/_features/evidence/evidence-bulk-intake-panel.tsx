"use client";

import {
  EVIDENCE_BULK_INTAKE_MAX_BYTES,
  EVIDENCE_BULK_INTAKE_MAX_ITEMS,
  EVIDENCE_MAX_UPLOAD_BYTES,
  type EvidenceBulkIntakeItem,
  type EvidenceDocumentVersion,
} from "@repo/contracts/evidence";
import { Button } from "@repo/ui/button";
import { CircleX, FileUp, RotateCcw, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { evidenceApi } from "./evidence.api";
import {
  useCancelEvidenceBulkIntakeItemMutation,
  useCompleteEvidenceBulkIntakeItemMutation,
  useCreateEvidenceBulkIntakeBatchMutation,
  useEvidenceBulkIntakeBatchQuery,
  useInitializeEvidenceBulkIntakeItemMutation,
  useRetryEvidenceBulkIntakeItemMutation,
} from "./evidence.queries";

type DocumentClass = EvidenceDocumentVersion["documentClass"];

const classes = [
  ["risk_assessment", "Risk assessment"],
  ["test_report", "Test report"],
  ["policy", "Policy"],
  ["procedure", "Procedure"],
  ["supplier_attestation", "Supplier attestation"],
  ["certificate", "Certificate"],
  ["architecture_document", "Architecture document"],
  ["other", "Other"],
] as const satisfies readonly (readonly [DocumentClass, string])[];
const extensions = new Set([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "csv",
  "txt",
  "jpg",
  "jpeg",
  "png",
  "webp",
]);

function requestId() {
  return crypto.randomUUID();
}

function titleFor(file: File) {
  return (
    file.name
      .replace(/\.[^.]+$/u, "")
      .replace(/[-_]+/gu, " ")
      .trim() || file.name
  );
}

function fileIssue(file: File) {
  if (file.size > EVIDENCE_MAX_UPLOAD_BYTES)
    return `${file.name} is larger than 50 MiB.`;
  return extensions.has(
    file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "",
  )
    ? null
    : `${file.name} is not an allowed evidence format.`;
}

function errorText(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403)
    return "Your evidence-upload permission changed. Refresh before retrying.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This batch changed elsewhere. Your selected files remain available to retry.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "The connection was interrupted. Your completed items are unchanged; retry only the affected item.";
  return error instanceof ApiClientError
    ? error.message
    : "The bulk evidence request could not be completed.";
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export function EvidenceBulkIntakePanel({
  productId,
  ownerUserId,
  enabled,
}: Readonly<{
  productId: string;
  ownerUserId: string;
  enabled: boolean;
}>) {
  const create = useCreateEvidenceBulkIntakeBatchMutation(productId);
  const initialize = useInitializeEvidenceBulkIntakeItemMutation(productId);
  const complete = useCompleteEvidenceBulkIntakeItemMutation(productId);
  const cancel = useCancelEvidenceBulkIntakeItemMutation(productId);
  const retry = useRetryEvidenceBulkIntakeItemMutation(productId);
  const [batchId, setBatchId] = useState<string | null>(null);
  const batch = useEvidenceBulkIntakeBatchQuery(productId, batchId, enabled);
  const files = useRef(new Map<string, File>());
  const transfers = useRef(new Map<string, AbortController>());
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [activeTransfers, setActiveTransfers] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<readonly File[]>([]);

  async function createBatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = selectedFiles.filter((file) => file.size > 0);
    if (selected.length === 0) {
      setMessage(
        "Choose one or more evidence files to begin a reviewable batch.",
      );
      return;
    }
    if (selected.length > EVIDENCE_BULK_INTAKE_MAX_ITEMS) {
      setMessage(
        `A batch can contain at most ${EVIDENCE_BULK_INTAKE_MAX_ITEMS} files.`,
      );
      return;
    }
    const issue = selected.map(fileIssue).find(Boolean);
    if (issue) {
      setMessage(issue);
      return;
    }
    if (
      selected.reduce((total, file) => total + file.size, 0) >
      EVIDENCE_BULK_INTAKE_MAX_BYTES
    ) {
      setMessage("A batch cannot exceed 250 MiB in total.");
      return;
    }
    const entries = selected.map((file) => {
      const clientItemId = requestId();
      files.current.set(clientItemId, file);
      return {
        clientItemId,
        idempotencyKey: requestId(),
        title: titleFor(file),
        ownerUserId,
        productIds: [productId],
        validFrom: null,
        validUntil: null,
        fileName: file.name,
        byteSize: file.size,
      };
    });
    setMessage(null);
    try {
      const response = await create.mutateAsync({
        idempotencyKey: requestId(),
        items: entries,
      });
      setBatchId(response.batch.id);
      event.currentTarget.reset();
      setSelectedFiles([]);
      setMessage(
        "Review each filename-based classification before any file is transferred.",
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function transfer(
    item: EvidenceBulkIntakeItem,
    documentClass: DocumentClass,
  ) {
    if (!batchId) return;
    if (transfers.current.size >= 3) {
      setMessage(
        "Three evidence transfers are already in progress. Wait for one to finish before starting another.",
      );
      return;
    }
    const file = files.current.get(item.clientItemId);
    if (!file) {
      setMessage(
        `Choose ${item.fileName} again before uploading this retained batch item.`,
      );
      return;
    }
    const controller = new AbortController();
    transfers.current.set(item.id, controller);
    setActiveTransfers(transfers.current.size);
    setProgress((current) => ({ ...current, [item.id]: 0 }));
    try {
      const reserved =
        item.status === "failed" || item.status === "cancelled"
          ? await retry.mutateAsync({
              batchId,
              itemId: item.id,
              input: {
                documentClass,
                classificationDecision:
                  documentClass === item.classification.suggestedDocumentClass
                    ? "accepted"
                    : "corrected",
                fileName: file.name,
                byteSize: file.size,
                idempotencyKey: requestId(),
              },
            })
          : await initialize.mutateAsync({
              batchId,
              itemId: item.id,
              input: {
                documentClass,
                classificationDecision:
                  documentClass === item.classification.suggestedDocumentClass
                    ? "accepted"
                    : "corrected",
                idempotencyKey: requestId(),
              },
            });
      await evidenceApi.uploadOriginal(
        reserved.upload.uploadUrl,
        file,
        (value) => setProgress((current) => ({ ...current, [item.id]: value })),
        controller.signal,
      );
      await complete.mutateAsync({
        batchId,
        itemId: item.id,
        input: { idempotencyKey: requestId() },
      });
      setMessage(`${item.fileName} is awaiting malware scanning.`);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(errorText(error));
    } finally {
      transfers.current.delete(item.id);
      setActiveTransfers(transfers.current.size);
      setProgress((current) => {
        const remaining = { ...current };
        delete remaining[item.id];
        return remaining;
      });
    }
  }

  async function cancelItem(item: EvidenceBulkIntakeItem) {
    if (!batchId) return;
    transfers.current.get(item.id)?.abort();
    try {
      await cancel.mutateAsync({
        batchId,
        itemId: item.id,
        input: { idempotencyKey: requestId() },
      });
      setMessage(
        `${item.fileName} was cancelled. Its private reserved object cannot become available.`,
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <section
      aria-labelledby="bulk-evidence-title"
      className="grid gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="grid gap-1">
        <h2 id="bulk-evidence-title" className="text-h5 text-fg">
          Bulk evidence intake
        </h2>
        <p className="text-caption-1-regular text-fg-muted">
          Review each filename-based class before upload. Files use the same
          private storage, verification, scan, and retention flow as single
          uploads.
        </p>
      </div>
      <form noValidate className="grid gap-3" onSubmit={createBatch}>
        <label
          htmlFor="bulk-evidence-files"
          className="grid gap-1 text-caption-1-semibold text-fg"
        >
          Evidence files
          <input
            id="bulk-evidence-files"
            name="bulk-evidence-files"
            type="file"
            aria-label="Evidence files"
            multiple
            disabled={create.isPending || batchId !== null}
            accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp"
            onChange={(event) =>
              setSelectedFiles(Array.from(event.currentTarget.files ?? []))
            }
            className="block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-2 file:py-1 file:text-caption-1-semibold"
          />
          <span className="text-caption-1-regular text-fg-muted">
            Up to 20 files, 50 MiB each, 250 MiB total.
          </span>
        </label>
        <div>
          <Button
            type="submit"
            loading={create.isPending}
            loadingLabel="Creating bulk review"
            disabled={batchId !== null}
          >
            <FileUp aria-hidden="true" />
            Create review batch
          </Button>
        </div>
      </form>
      {message ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg"
        >
          {message}
        </p>
      ) : null}
      {batch.isLoading ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Loading bulk intake status…
        </p>
      ) : null}
      {batch.isError ? (
        <div className="grid gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            The bulk intake status could not be loaded.
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void batch.refetch()}
            >
              Retry status
            </Button>
          </div>
        </div>
      ) : null}
      {batch.data ? (
        <>
          <p className="text-caption-1-regular text-fg-muted">
            {batch.data.batch.counts.success} successful ·{" "}
            {batch.data.batch.counts.pending} pending ·{" "}
            {batch.data.batch.counts.rejected} rejected
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b border-border text-caption-1-semibold text-fg-muted">
                <tr>
                  <th className="px-2 py-2">File</th>
                  <th className="px-2 py-2">Suggested class</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {batch.data.batch.items.map((item) => (
                  <BulkItemRow
                    key={item.id}
                    item={item}
                    progress={progress[item.id]}
                    busy={transfers.current.has(item.id)}
                    queueFull={activeTransfers >= 3}
                    onTransfer={transfer}
                    onCancel={cancelItem}
                    onChooseRetry={(file) =>
                      files.current.set(item.clientItemId, file)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function BulkItemRow({
  item,
  progress,
  busy,
  queueFull,
  onTransfer,
  onCancel,
  onChooseRetry,
}: Readonly<{
  item: EvidenceBulkIntakeItem;
  progress: number | undefined;
  busy: boolean;
  queueFull: boolean;
  onTransfer: (
    item: EvidenceBulkIntakeItem,
    documentClass: DocumentClass,
  ) => Promise<void>;
  onCancel: (item: EvidenceBulkIntakeItem) => Promise<void>;
  onChooseRetry: (file: File) => void;
}>) {
  const [documentClass, setDocumentClass] = useState<DocumentClass>(
    item.classification.documentClass ??
      item.classification.suggestedDocumentClass,
  );
  const canTransfer =
    item.status === "unconfirmed" ||
    item.status === "ready" ||
    item.status === "failed" ||
    item.status === "cancelled";
  return (
    <tr className="border-b border-border align-top">
      <td className="px-2 py-3">
        <p className="text-caption-1-semibold text-fg">{item.fileName}</p>
        <p className="text-caption-1-regular text-fg-muted">
          {Math.ceil(item.byteSize / 1024)} KiB
        </p>
      </td>
      <td className="px-2 py-3">
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          <span className="sr-only">Classification for {item.fileName}</span>
          <select
            value={documentClass}
            disabled={!canTransfer || busy}
            onChange={(event) =>
              setDocumentClass(event.target.value as DocumentClass)
            }
            className="rounded-lg border border-border bg-canvas px-2 py-1 text-caption-1-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {classes.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          <span className="text-caption-1-regular text-fg-muted">
            Suggestion: {label(item.classification.suggestedDocumentClass)} ·{" "}
            {item.classification.decision}
          </span>
        </label>
      </td>
      <td className="px-2 py-3 text-caption-1-regular text-fg-muted">
        {label(item.status)}
        {progress !== undefined ? ` · ${Math.round(progress * 100)}%` : ""}
        {item.errorCode ? ` · ${label(item.errorCode)}` : ""}
      </td>
      <td className="px-2 py-3">
        <div className="flex flex-wrap gap-2">
          {canTransfer ? (
            <Button
              type="button"
              size="sm"
              disabled={queueFull && !busy}
              loading={busy}
              loadingLabel="Uploading item"
              onClick={() => void onTransfer(item, documentClass)}
            >
              {item.status === "failed" || item.status === "cancelled" ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Upload aria-hidden="true" />
              )}
              {item.status === "failed" || item.status === "cancelled"
                ? "Retry"
                : "Confirm and upload"}
            </Button>
          ) : null}
          {item.status === "unconfirmed" ||
          item.status === "ready" ||
          item.status === "uploading" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              tone="grey"
              onClick={() => void onCancel(item)}
            >
              <CircleX aria-hidden="true" />
              Cancel
            </Button>
          ) : null}
        </div>
        {item.status === "failed" || item.status === "cancelled" ? (
          <label className="mt-2 grid gap-1 text-caption-1-regular text-fg-muted">
            Replacement file
            <input
              type="file"
              className="block w-full text-caption-1-regular"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onChooseRetry(file);
              }}
            />
          </label>
        ) : null}
      </td>
    </tr>
  );
}
