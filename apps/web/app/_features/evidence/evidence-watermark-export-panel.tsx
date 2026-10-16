"use client";

import type { EvidenceDocumentVersion } from "@repo/contracts/evidence";
import { Button } from "@repo/ui/button";
import { Eye, Send, Stamp } from "lucide-react";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateEvidenceWatermarkExportMutation,
  useDeliverEvidenceWatermarkExportMutation,
  useEvidenceWatermarkExportQuery,
  usePreviewEvidenceWatermarkExportMutation,
} from "./evidence.queries";

function requestId() {
  return crypto.randomUUID();
}

function errorText(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to release this evidence externally.";
  if (error instanceof ApiClientError && error.status === 409)
    return "The referenced version changed or is no longer eligible. Your recipient and purpose are still here; refresh before retrying.";
  if (error instanceof ApiClientError && error.status === 422)
    return "This format cannot be watermarked safely. The original was not exported.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "Evidence services are temporarily unavailable. Your recipient and purpose are still here.";
  return error instanceof ApiClientError
    ? error.message
    : "The watermarked export request could not be completed.";
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export function EvidenceWatermarkExportPanel({
  productId,
  documentId,
  version,
  enabled,
  canManage,
}: Readonly<{
  productId: string;
  documentId: string;
  version: EvidenceDocumentVersion;
  enabled: boolean;
  canManage: boolean;
}>) {
  const create = useCreateEvidenceWatermarkExportMutation(productId);
  const preview = usePreviewEvidenceWatermarkExportMutation(productId);
  const delivery = useDeliverEvidenceWatermarkExportMutation(productId);
  const [recipient, setRecipient] = useState("");
  const [purpose, setPurpose] = useState("");
  const [exportId, setExportId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = useEvidenceWatermarkExportQuery(
    productId,
    documentId,
    version.id,
    exportId,
    enabled && canManage,
  );
  const supported =
    version.mediaType !== null &&
    ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
      version.mediaType,
    );
  const ready = current.data?.export.status === "ready";

  async function requestExport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supported) {
      setMessage(
        "This file format is not supported for a watermark derivative. The original cannot be delivered unwatermarked from this panel.",
      );
      return;
    }
    if (recipient.trim() === "" || purpose.trim() === "") {
      setMessage("Provide both the recipient and the external-review purpose.");
      return;
    }
    setMessage(null);
    setPreviewUrl(null);
    try {
      const response = await create.mutateAsync({
        documentId,
        versionId: version.id,
        input: { recipient, purpose, idempotencyKey: requestId() },
      });
      setExportId(response.export.id);
      setMessage(
        "The watermarked derivative is queued from this exact immutable source version.",
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function previewExport() {
    if (!exportId) return;
    setMessage(null);
    try {
      const response = await preview.mutateAsync({
        documentId,
        versionId: version.id,
        exportId,
        input: { idempotencyKey: requestId() },
      });
      setPreviewUrl(response.preview.deliveryUrl);
      setMessage(
        "Preview access is recorded and expires shortly. Confirm the visible watermark before delivery.",
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function deliverExport() {
    if (!exportId) return;
    setMessage(null);
    try {
      const response = await delivery.mutateAsync({
        documentId,
        versionId: version.id,
        exportId,
        input: { idempotencyKey: requestId() },
      });
      const anchor = document.createElement("a");
      anchor.href = response.access.deliveryUrl;
      anchor.download = response.access.fileName;
      anchor.referrerPolicy = "no-referrer";
      anchor.rel = "noreferrer";
      anchor.click();
      setMessage(
        "Watermarked derivative delivery started. The original signature and integrity record remain unchanged.",
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  if (!canManage) return null;
  return (
    <section
      aria-labelledby="watermark-export-title"
      className="mt-4 grid gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="grid gap-1">
        <h3 id="watermark-export-title" className="text-h5 text-fg">
          Recipient-watermarked export
        </h3>
        <p className="text-caption-1-regular text-fg-muted">
          Creates a separate, private derivative for external review. It never
          changes the original file, source hash, signature, or snapshot
          reference.
        </p>
      </div>
      {!supported ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg-muted"
        >
          Watermark export is supported for PDF, JPEG, PNG, and WebP only. This{" "}
          {version.mediaType} original remains protected and cannot be sent
          unwatermarked from here.
        </p>
      ) : (
        <form noValidate className="grid gap-3" onSubmit={requestExport}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-caption-1-semibold text-fg">
              Recipient
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                maxLength={160}
                required
                className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
            <label className="grid gap-1 text-caption-1-semibold text-fg">
              External-review purpose
              <input
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                maxLength={160}
                required
                className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
          </div>
          <div>
            <Button
              type="submit"
              loading={create.isPending}
              loadingLabel="Queuing watermark export"
              disabled={version.status !== "clean"}
            >
              <Stamp aria-hidden="true" />
              Create watermarked preview
            </Button>
          </div>
        </form>
      )}
      {message ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg"
        >
          {message}
        </p>
      ) : null}
      {current.isLoading ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Checking watermark export status…
        </p>
      ) : null}
      {current.isError ? (
        <div className="grid gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            Watermark export status could not be loaded.
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void current.refetch()}
            >
              Retry status
            </Button>
          </div>
        </div>
      ) : null}
      {current.data ? (
        <div className="grid gap-3 rounded-lg border border-border bg-canvas p-3">
          <p className="text-caption-1-semibold text-fg">
            Export status: {label(current.data.export.status)}
          </p>
          {current.data.export.status === "failed" ? (
            <p className="text-caption-1-regular text-fg-muted">
              Safe failure:{" "}
              {label(current.data.export.failureCode ?? "unknown")}. The
              original was not exported.
            </p>
          ) : null}
          {ready && current.data.export.derivative ? (
            <>
              <p className="text-caption-1-regular text-fg-muted">
                Derivative SHA-256:{" "}
                <span className="font-mono">
                  {current.data.export.derivative.sha256}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  loading={preview.isPending}
                  onClick={() => void previewExport()}
                >
                  <Eye aria-hidden="true" />
                  Preview exact derivative
                </Button>
                <Button
                  type="button"
                  loading={delivery.isPending}
                  disabled={current.data.export.previewedAt === null}
                  onClick={() => void deliverExport()}
                >
                  <Send aria-hidden="true" />
                  Deliver reviewed derivative
                </Button>
              </div>
              {current.data.export.previewedAt === null ? (
                <p className="text-caption-1-regular text-fg-muted">
                  Preview is required before delivery.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {previewUrl ? (
        <WatermarkPreview
          url={previewUrl}
          fileName={
            current.data?.export.derivative?.fileName ?? version.fileName
          }
          mediaType={
            current.data?.export.derivative?.mediaType ??
            version.mediaType ??
            "application/octet-stream"
          }
        />
      ) : null}
    </section>
  );
}

function WatermarkPreview({
  url,
  fileName,
  mediaType,
}: Readonly<{ url: string; fileName: string; mediaType: string }>) {
  return (
    <div className="min-h-72 rounded-xl border border-border bg-canvas p-3">
      {mediaType === "application/pdf" ? (
        <iframe
          title={`Watermarked preview of ${fileName}`}
          src={url}
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          className="h-[32rem] w-full rounded-lg border border-border bg-surface"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- preview uses a short-lived authenticated blob URL, not an optimizable asset.
        <img
          src={url}
          alt={`Watermarked preview of ${fileName}`}
          referrerPolicy="no-referrer"
          className="max-h-[32rem] w-full object-contain"
        />
      )}
    </div>
  );
}
