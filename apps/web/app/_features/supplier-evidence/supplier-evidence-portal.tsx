"use client";

import {
  completeSupplierEvidencePortalUploadInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
  supplierEvidencePortalRequestSchema,
} from "@repo/contracts/supplier-evidence";
import { Button } from "@repo/ui/button";
import { Clock3, Link2Off, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";

import { ApiClientError } from "../../_lib/http/api-client";
import { supplierEvidenceApi } from "./supplier-evidence.api";

const SESSION_KEY = "cra.supplier-evidence.portal-session";
const pendingFinalizeKey = (requestReference: string) =>
  `cra.supplier-evidence.pending-finalize.${requestReference}`;
type SupplierEvidencePortalRequest = z.output<
  typeof supplierEvidencePortalRequestSchema
>;
type PendingFinalization = Readonly<{
  versionId: string;
  idempotencyKey: string;
}>;

function pendingFinalization(
  requestReference: string,
): PendingFinalization | null {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(pendingFinalizeKey(requestReference)) ?? "null",
    );
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      const versionId = record.versionId;
      const idempotencyKey = record.idempotencyKey;
      if (typeof versionId !== "string" || typeof idempotencyKey !== "string")
        return null;
      return Object.freeze({
        versionId,
        idempotencyKey,
      });
    }
  } catch {
    // A corrupt tab-local retry marker never grants access and is discarded.
  }
  return null;
}

function messageFor(error: unknown): string {
  if (
    error instanceof ApiClientError &&
    (error.status === 401 || error.status === 403 || error.status === 410)
  )
    return "This portal link is expired, revoked, or no longer available.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "We could not reach the evidence service. Your selected file is still available to retry.";
  return error instanceof ApiClientError
    ? error.message
    : "The supplier evidence request could not be completed.";
}

function portalFragment(): string | null {
  const raw = window.location.hash.slice(1);
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  return (
    params.get("invitation") ??
    params.get("token") ??
    (raw.includes("=") ? null : raw)
  );
}

async function sha256(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function SubmissionState({ state }: Readonly<{ state: string }>) {
  const copy: Record<string, string> = {
    uploading: "Upload in progress",
    scan_pending: "Awaiting malware scan",
    submitted_pending_review: "Submitted for internal review",
    accepted: "Accepted for authorized reuse eligibility",
    rejected: "Rejected",
    re_requested: "Re-requested",
    failed: "Processing failed",
  };
  return (
    <span className="text-caption-1-regular text-fg-muted">
      {copy[state] ?? state}
    </span>
  );
}

function PortalRequest({
  request,
  sessionToken,
  refresh,
}: Readonly<{
  request: SupplierEvidencePortalRequest;
  sessionToken: string;
  refresh: () => Promise<void>;
}>) {
  const [itemId, setItemId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<PendingFinalization | null>(() =>
    pendingFinalization(request.requestReference),
  );
  const active = useMemo(
    () =>
      request.items.filter(
        (item) =>
          !request.submissions.some(
            (submission) =>
              submission.checklistItemId === item.id &&
              submission.state !== "rejected" &&
              submission.state !== "re_requested",
          ),
      ),
    [request.items, request.submissions],
  );
  async function finalizePending(
    candidate: PendingFinalization,
  ): Promise<void> {
    await supplierEvidenceApi.completePortalUpload(
      candidate.versionId,
      completeSupplierEvidencePortalUploadInputSchema.parse({
        sessionToken,
        idempotencyKey: candidate.idempotencyKey,
      }),
    );
    sessionStorage.removeItem(pendingFinalizeKey(request.requestReference));
    setPending(null);
    await refresh();
  }
  async function retryFinalization() {
    if (!pending) return;
    setMessage(null);
    setUploading(true);
    try {
      await finalizePending(pending);
      setMessage(
        "Upload received. It remains private and is awaiting malware scanning before internal review.",
      );
    } catch {
      setMessage(
        "The upload is private but finalization needs a retry. Your selected file is not uploaded again.",
      );
    } finally {
      setUploading(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    let hasPendingFinalization = false;
    if (!file || !itemId) {
      setMessage("Select a request item and an evidence file.");
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const initializedInput =
        initializeSupplierEvidencePortalUploadInputSchema.parse({
          sessionToken,
          checklistItemId: itemId,
          fileName: file.name,
          mediaType: file.type,
          byteSize: file.size,
          sha256: await sha256(file),
          idempotencyKey: crypto.randomUUID(),
        });
      const initialized =
        await supplierEvidenceApi.initializePortalUpload(initializedInput);
      await supplierEvidenceApi.uploadPrivateObject(
        initialized.upload.uploadUrl,
        file,
        setProgress,
      );
      const candidate = Object.freeze({
        versionId: initialized.versionId,
        idempotencyKey: crypto.randomUUID(),
      });
      sessionStorage.setItem(
        pendingFinalizeKey(request.requestReference),
        JSON.stringify(candidate),
      );
      setPending(candidate);
      hasPendingFinalization = true;
      await finalizePending(candidate);
      setFile(null);
      setItemId("");
      setProgress(null);
      setMessage(
        "Upload received. It remains private and is awaiting malware scanning before internal review.",
      );
      await refresh();
    } catch (error) {
      setMessage(
        hasPendingFinalization
          ? "The upload is private but finalization needs a retry. Your selected file is not uploaded again."
          : messageFor(error),
      );
    } finally {
      setUploading(false);
    }
  }
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="border-b border-border pb-5">
        <div className="flex items-center gap-2 text-caption-1-regular text-fg-muted">
          <ShieldCheck aria-hidden="true" className="size-4" /> Secure supplier
          evidence portal
        </div>
        <h1 className="mt-2 text-h4 text-fg">{request.title}</h1>
        <p className="mt-1 text-subhead-regular text-fg-muted">
          Request reference: {request.requestReference}
        </p>
        <p className="mt-3 flex items-center gap-2 text-caption-1-regular text-fg">
          <Clock3 aria-hidden="true" className="size-4" /> Due{" "}
          {formatDate(request.dueAt)}
        </p>
      </header>
      <section className="mt-6" aria-labelledby="portal-instructions">
        <h2 id="portal-instructions" className="text-subhead-semibold text-fg">
          Instructions
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-subhead-regular text-fg-muted">
          {request.instructions ?? "No additional instructions were supplied."}
        </p>
        {request.disclosureContent ? (
          <p className="mt-3 whitespace-pre-wrap text-caption-1-regular text-fg-muted">
            {request.disclosureContent}
          </p>
        ) : null}
      </section>
      <section className="mt-8" aria-labelledby="portal-checklist">
        <h2 id="portal-checklist" className="text-subhead-semibold text-fg">
          Requested evidence
        </h2>
        <ul className="mt-3 grid gap-3">
          {request.items.map((item) => {
            const submissions = request.submissions.filter(
              (submission) => submission.checklistItemId === item.id,
            );
            return (
              <li
                key={item.id}
                className="rounded-xl border border-border bg-canvas p-4"
              >
                <h3 className="text-subhead-semibold text-fg">
                  {item.position + 1}. {item.title}
                </h3>
                {item.instructions ? (
                  <p className="mt-1 whitespace-pre-wrap text-caption-1-regular text-fg-muted">
                    {item.instructions}
                  </p>
                ) : null}
                {item.reRequestReason ? (
                  <p
                    role="status"
                    className="mt-2 whitespace-pre-wrap text-caption-1-regular text-fg-muted"
                  >
                    Re-request reason: {item.reRequestReason}
                  </p>
                ) : null}
                <div className="mt-2 grid gap-1">
                  {submissions.length === 0 ? (
                    <span className="text-caption-1-regular text-fg-muted">
                      No file submitted
                    </span>
                  ) : (
                    submissions.map((submission) => (
                      <div
                        key={submission.id}
                        className="flex flex-wrap justify-between gap-2 text-caption-1-regular text-fg"
                      >
                        <span>{submission.fileName}</span>
                        <SubmissionState state={submission.state} />
                        {submission.rejectionReason ? (
                          <span
                            role="status"
                            className="basis-full text-fg-muted"
                          >
                            {submission.rejectionReason}
                          </span>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section
        className="mt-8 rounded-2xl border border-border bg-surface p-5"
        aria-labelledby="portal-upload"
      >
        <h2 id="portal-upload" className="text-subhead-semibold text-fg">
          Submit evidence
        </h2>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Uploads are private, immutable, and checked before review. A
          successful upload is not an acceptance decision.
        </p>
        {active.length === 0 ? (
          <div className="mt-3 grid gap-3">
            <p role="status" className="text-caption-1-regular text-fg-muted">
              All assigned items have a submitted or accepted version.
            </p>
            {pending ? (
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => void retryFinalization()}
              >
                {uploading ? "Finalizing…" : "Retry finalization"}
              </Button>
            ) : null}
            {message ? (
              <p role="status" className="text-caption-1-regular text-fg-muted">
                {message}
              </p>
            ) : null}
          </div>
        ) : (
          <form
            className="mt-4 grid gap-3"
            noValidate
            onSubmit={(event) => void submit(event)}
          >
            <label className="grid gap-1 text-caption-1-regular text-fg">
              Request item
              <select
                required
                disabled={uploading}
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
                className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              >
                <option value="">Select an item</option>
                {active.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-caption-1-regular text-fg">
              Evidence file{" "}
              <span className="text-fg-muted">
                (PDF, Office, CSV, or text; 50 MiB maximum)
              </span>
              <input
                required
                type="file"
                accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/plain"
                disabled={uploading}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-caption-1-regular text-fg"
              />
            </label>
            {progress !== null ? (
              <p role="status" className="text-caption-1-regular text-fg-muted">
                Uploading {Math.round(progress * 100)}%
              </p>
            ) : null}
            {message ? (
              <p role="status" className="text-caption-1-regular text-fg-muted">
                {message}
              </p>
            ) : null}
            <Button type="submit" disabled={uploading}>
              {uploading ? "Uploading…" : "Upload private evidence"}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}

export function SupplierEvidencePortal() {
  const [request, setRequest] = useState<SupplierEvidencePortalRequest | null>(
    null,
  );
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "expired" | "error">(
    "loading",
  );
  const [message, setMessage] = useState<string | null>(null);
  const opening = useRef(false);
  async function openInvitation(token: string) {
    const response = await supplierEvidenceApi.openPortal({
      invitationToken: token,
    });
    sessionStorage.setItem(SESSION_KEY, response.session.sessionToken);
    setSessionToken(response.session.sessionToken);
    setRequest(response.session.request);
    setState("loading");
  }
  async function reloadSession(token: string) {
    const nextRequest = await supplierEvidenceApi.portalRequest(token);
    setSessionToken(token);
    setRequest(nextRequest);
    setState("loading");
  }
  useEffect(() => {
    if (opening.current) return;
    opening.current = true;
    const invitation = portalFragment();
    if (invitation)
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    const retained = sessionStorage.getItem(SESSION_KEY);
    const token = invitation ?? retained;
    if (!token) {
      setState("expired");
      return;
    }
    void (invitation ? openInvitation(token) : reloadSession(token)).catch(
      (error) => {
        sessionStorage.removeItem(SESSION_KEY);
        setMessage(messageFor(error));
        setState(
          error instanceof ApiClientError &&
            [401, 403, 410].includes(error.status ?? 0)
            ? "expired"
            : "error",
        );
      },
    );
  }, []);
  if (request && sessionToken)
    return (
      <PortalRequest
        request={request}
        sessionToken={sessionToken}
        refresh={async () => {
          await reloadSession(sessionToken);
        }}
      />
    );
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center px-4 py-8">
      <section className="w-full rounded-2xl border border-border bg-canvas p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-fg">
          {state === "loading" ? (
            <ShieldCheck aria-hidden="true" className="size-6" />
          ) : (
            <Link2Off aria-hidden="true" className="size-6" />
          )}
        </div>
        <h1 className="mt-4 text-h5 text-fg">
          {state === "loading"
            ? "Opening secure request…"
            : "This supplier link is unavailable"}
        </h1>
        <p
          role={state === "loading" ? "status" : "alert"}
          className="mt-2 text-subhead-regular text-fg-muted"
        >
          {state === "loading"
            ? "Verifying your scoped invitation."
            : (message ?? "Ask the request owner to issue a new invitation.")}
        </p>
      </section>
    </main>
  );
}
