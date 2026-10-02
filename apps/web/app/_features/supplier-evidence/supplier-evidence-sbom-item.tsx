"use client";

import {
  SBOM_MAX_UPLOAD_BYTES,
  sbomMediaTypeSchema,
} from "@repo/contracts/sboms";
import {
  completeSupplierEvidenceSbomUploadInputSchema,
  initializeSupplierEvidenceSbomUploadInputSchema,
  supplierEvidencePortalRequestSchema,
} from "@repo/contracts/supplier-evidence";
import { Button } from "@repo/ui/button";
import { useEffect, useState } from "react";
import type { z } from "zod";

import { ApiClientError } from "../../_lib/http/api-client";
import { supplierEvidenceApi } from "./supplier-evidence.api";

type PortalItem = z.output<
  typeof supplierEvidencePortalRequestSchema
>["items"][number];
type PendingFinalization = Readonly<{
  sourceId: string;
  idempotencyKey: string;
}>;
const pendingKey = (reference: string, itemId: string) =>
  `cra.supplier-evidence.sbom-pending-finalize.${reference}.${itemId}`;

function savedFinalization(
  reference: string,
  itemId: string,
): PendingFinalization | null {
  try {
    const parsed: unknown = JSON.parse(
      sessionStorage.getItem(pendingKey(reference, itemId)) ?? "null",
    );
    if (parsed && typeof parsed === "object") {
      const value = parsed as Record<string, unknown>;
      if (
        typeof value.sourceId === "string" &&
        typeof value.idempotencyKey === "string"
      )
        return {
          sourceId: value.sourceId,
          idempotencyKey: value.idempotencyKey,
        };
    }
  } catch {
    // A corrupt tab-local retry hint carries no authority.
  }
  return null;
}

function safeMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if ([401, 403, 410].includes(error.status ?? 0))
      return "This supplier link is no longer available. Ask the request owner for a new invitation.";
    if (error.status === 409)
      return "This SBOM request changed. Refresh the page and retry with the current request.";
    if (error.kind === "network")
      return "The service is unreachable. Your selected file is still available to retry.";
    if ((error.status ?? 0) >= 500)
      return "The SBOM service could not complete the request. Retry shortly; your selected file is still available.";
    return error.message;
  }
  return "The SBOM could not be submitted. Check the file and try again.";
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function stateText(state: string): string {
  const states: Record<string, string> = {
    pending: "Upload reserved",
    processing: "Processing in the standard SBOM intake pipeline",
    validation_failed: "Validation failed; a corrected file may be submitted",
    awaiting_review: "Awaiting internal SBOM review",
    accepted: "Accepted by an authorized SBOM reviewer",
    rejected: "Rejected by an authorized SBOM reviewer",
    superseded: "Superseded by a later submission",
  };
  return states[state] ?? "Status unavailable";
}

export function SupplierEvidenceSbomItem({
  item,
  sessionToken,
  requestReference,
  refresh,
}: Readonly<{
  item: PortalItem;
  sessionToken: string;
  requestReference: string;
  refresh: () => Promise<void>;
}>) {
  const [file, setFile] = useState<File | null>(null);
  const [declaredFormat, setDeclaredFormat] = useState<
    "" | "cyclonedx" | "spdx"
  >("");
  const [declaredSpecVersion, setDeclaredSpecVersion] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingFinalization | null>(() =>
    savedFinalization(requestReference, item.id),
  );
  const submission = item.sbom?.submission ?? null;
  const canUpload =
    !submission ||
    ["pending", "validation_failed", "rejected", "superseded"].includes(
      submission.state,
    );

  useEffect(() => {
    if (submission?.state !== "pending" && submission?.state !== "processing")
      return;
    const interval = window.setInterval(
      () => void refresh().catch(() => undefined),
      5_000,
    );
    return () => window.clearInterval(interval);
  }, [refresh, submission?.state]);

  async function finalize(candidate: PendingFinalization) {
    await supplierEvidenceApi.completeSbomPortalUpload(
      item.id,
      candidate.sourceId,
      completeSupplierEvidenceSbomUploadInputSchema.parse({
        sessionToken,
        idempotencyKey: candidate.idempotencyKey,
      }),
    );
    await refresh();
    sessionStorage.removeItem(pendingKey(requestReference, item.id));
    setPending(null);
  }

  async function retryFinalization() {
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      await finalize(pending);
      setMessage(
        "SBOM received. Processing and internal review are separate from baseline acceptance.",
      );
    } catch (error) {
      setMessage(
        error instanceof ApiClientError &&
          [403, 409].includes(error.status ?? 0)
          ? "This saved retry cannot be finalized with the current session. If the invitation was reissued, discard the saved retry and submit a new file."
          : `${safeMessage(error)} Finalization can be retried without re-uploading the file.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function discardPending() {
    sessionStorage.removeItem(pendingKey(requestReference, item.id));
    setPending(null);
    setFile(null);
    setProgress(null);
    setMessage(
      "Saved retry removed from this tab. Any previously uploaded source remains private and immutable. Refresh status before submitting another file.",
    );
  }

  async function refreshStatus() {
    setMessage(null);
    try {
      await refresh();
    } catch (error) {
      setMessage(safeMessage(error));
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !item.sbom || pending) return;
    if (file.size > SBOM_MAX_UPLOAD_BYTES) {
      setMessage("This file exceeds the 100 MiB SBOM limit.");
      return;
    }
    const mediaType = file.type || "application/octet-stream";
    if (!sbomMediaTypeSchema.safeParse(mediaType).success) {
      setMessage("Use a CycloneDX or SPDX JSON or XML file.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setProgress(0);
    try {
      const input = initializeSupplierEvidenceSbomUploadInputSchema.parse({
        sessionToken,
        fileName: file.name,
        mediaType,
        byteSize: file.size,
        sha256: await sha256(file),
        idempotencyKey: crypto.randomUUID(),
        declaredFormat: declaredFormat || undefined,
        declaredSpecVersion: declaredSpecVersion.trim() || undefined,
      });
      const initialized = await supplierEvidenceApi.initializeSbomPortalUpload(
        item.id,
        input,
      );
      await supplierEvidenceApi.uploadPrivateObject(
        initialized.upload.uploadUrl,
        file,
        setProgress,
      );
      const candidate = {
        sourceId: initialized.sourceId,
        idempotencyKey: input.idempotencyKey,
      };
      sessionStorage.setItem(
        pendingKey(requestReference, item.id),
        JSON.stringify(candidate),
      );
      setPending(candidate);
      await finalize(candidate);
      setFile(null);
      setProgress(null);
      setMessage(
        "SBOM received. Processing and internal review are separate from baseline acceptance.",
      );
    } catch (error) {
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!item.sbom)
    return (
      <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
        This SBOM request is unavailable. Ask the request owner to reissue it.
      </p>
    );

  return (
    <div className="mt-3 grid gap-3 border-t border-border pt-3">
      <p className="text-caption-1-regular text-fg">
        Allowed component: <strong>{item.sbom.allowedComponentRef}</strong>
      </p>
      {submission ? (
        <div
          role="status"
          className="grid gap-1 text-caption-1-regular text-fg"
        >
          <p>
            {submission.fileName} · {stateText(submission.state)}
          </p>
          {submission.validationMessage ? (
            <p>{submission.validationMessage}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-caption-1-regular text-fg-muted">
          No SBOM submitted yet.
        </p>
      )}
      {submission ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void refreshStatus()}
        >
          Refresh status
        </Button>
      ) : null}
      {pending ? (
        <div className="grid gap-2">
          <p className="text-caption-1-regular text-fg">
            A finalization retry is saved in this tab. Discard it only if it
            cannot be retried, such as after an invitation is reissued.
            Discarding does not delete an uploaded source.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void retryFinalization()}
            >
              {busy ? "Finalizing…" : "Retry finalization"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={discardPending}
            >
              Discard saved retry
            </Button>
          </div>
        </div>
      ) : null}
      {canUpload && !pending ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <p className="text-caption-1-regular text-fg-muted">
            CycloneDX or SPDX JSON/XML; 100 MiB maximum. Upload is private and
            does not accept a product baseline.
          </p>
          <label className="grid gap-1 text-caption-1-regular text-fg">
            SBOM file
            <input
              required
              type="file"
              accept=".json,.xml,.cdx.json,.spdx.json,application/json,application/xml,text/xml"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-caption-1-regular text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-caption-1-regular text-fg">
              Declared format (optional)
              <select
                value={declaredFormat}
                onChange={(event) =>
                  setDeclaredFormat(event.target.value as typeof declaredFormat)
                }
                disabled={busy}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <option value="">Detect from file</option>
                <option value="cyclonedx">CycloneDX</option>
                <option value="spdx">SPDX</option>
              </select>
            </label>
            <label className="grid gap-1 text-caption-1-regular text-fg">
              Specification version (optional)
              <input
                value={declaredSpecVersion}
                maxLength={40}
                onChange={(event) => setDeclaredSpecVersion(event.target.value)}
                disabled={busy}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
            </label>
          </div>
          {progress !== null ? (
            <p role="status" className="text-caption-1-regular text-fg">
              Uploading {Math.round(progress * 100)}%
            </p>
          ) : null}
          <Button type="submit" disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload SBOM"}
          </Button>
        </form>
      ) : null}
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg">
          {message}
        </p>
      ) : null}
    </div>
  );
}
