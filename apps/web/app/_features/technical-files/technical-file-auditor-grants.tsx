"use client";

import type { TechnicalFileSnapshotExport } from "@repo/contracts/technical-files";
import { Button } from "@repo/ui/button";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateTechnicalFileAuditorGrantMutation,
  useRevokeTechnicalFileAuditorGrantMutation,
  useTechnicalFileAuditorGrantPreviewQuery,
  useTechnicalFileAuditorGrantsQuery,
} from "./technical-files.queries";

function requestId() { return crypto.randomUUID(); }

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) return "You no longer have permission to share this snapshot.";
  if (error instanceof ApiClientError && error.status === 409) return "This snapshot access record changed. Reload and try again; entered details are still here.";
  if (error instanceof ApiClientError && (error.kind === "network" || (error.status ?? 0) >= 500)) return "Auditor access is temporarily unavailable. Nothing was replayed; retry when the connection is restored.";
  return error instanceof ApiClientError ? error.message : "The auditor access change could not be saved.";
}

function date(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function TechnicalFileAuditorGrants({
  productId, snapshotId, exportRecord, canShare,
}: {
  productId: string;
  snapshotId: string;
  exportRecord: TechnicalFileSnapshotExport;
  canShare: boolean;
}) {
  const grants = useTechnicalFileAuditorGrantsQuery(productId, snapshotId, canShare);
  const preview = useTechnicalFileAuditorGrantPreviewQuery(productId, snapshotId, exportRecord.id, canShare && exportRecord.status === "ready");
  const create = useCreateTechnicalFileAuditorGrantMutation(productId, snapshotId);
  const revoke = useRevokeTechnicalFileAuditorGrantMutation(productId, snapshotId);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientReference, setRecipientReference] = useState("");
  const [purpose, setPurpose] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [deliveryUrl, setDeliveryUrl] = useState<string | null>(null);

  if (!canShare || exportRecord.status !== "ready") return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!preview.data) return setMessage("Wait for the immutable scope preview before creating access.");
    if (!recipientEmail.trim() || !purpose.trim() || !expiresAt) return setMessage("Recipient email, purpose, and expiry are required.");
    try {
      const response = await create.mutateAsync({
        exportId: exportRecord.id,
        recipientEmail: recipientEmail.trim(),
        recipientReference: recipientReference.trim() || null,
        purpose: purpose.trim(),
        expiresAt: new Date(expiresAt).toISOString(),
        idempotencyKey: requestId(),
      });
      setDeliveryUrl(response.deliveryUrl);
      setMessage("Scoped auditor access was created. Copy the delivery link now; it is not shown again.");
    } catch (error) { setMessage(errorMessage(error)); }
  }

  async function copyDeliveryUrl() {
    if (!deliveryUrl) return;
    try { await navigator.clipboard.writeText(deliveryUrl); setMessage("The one-time delivery link was copied."); }
    catch { setMessage("Copy the displayed delivery link manually. It will not be shown again after leaving this page."); }
  }

  async function revokeGrant(grantId: string, expectedVersion: number) {
    setMessage(null);
    try {
      await revoke.mutateAsync({ grantId, expectedVersion, reason: "Access revoked by the granting organization.", idempotencyKey: requestId() });
      setMessage("Auditor access was revoked. Any already-issued artifact delivery may remain usable only for its short delivery lifetime.");
    } catch (error) { setMessage(errorMessage(error)); }
  }

  return (
    <section aria-labelledby={`auditor-grants-${snapshotId}`} className="mt-4 rounded-xl border border-border bg-surface-subtle p-4">
      <h3 id={`auditor-grants-${snapshotId}`} className="text-subhead-semibold text-fg">Auditor access</h3>
      <p className="mt-1 max-w-[75ch] text-caption-1-regular text-fg-muted">Grant read-only access to this immutable snapshot and ready export only. Access cannot browse this workspace or other records.</p>
      {preview.data ? <p className="mt-3 text-caption-1-regular text-fg-muted">Scope: revision {preview.data.preview.snapshotRevision} · {preview.data.preview.snapshotStatus} · export {preview.data.preview.export.status} · expires no later than {date(preview.data.preview.maxExpiresAt)}.</p> : <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">Checking immutable scope…</p>}
      {message ? <p role="status" aria-live="polite" className="mt-3 text-subhead-regular text-fg-muted">{message}</p> : null}
      <form onSubmit={submit} noValidate className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">Auditor email<input required type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} disabled={create.isPending} className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label>
        <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">Recipient reference (optional)<input value={recipientReference} onChange={(event) => setRecipientReference(event.target.value)} disabled={create.isPending} maxLength={300} className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label>
        <label className="flex flex-col gap-1 text-caption-1-semibold text-fg sm:col-span-2">Purpose<textarea required rows={2} value={purpose} onChange={(event) => setPurpose(event.target.value)} disabled={create.isPending} maxLength={2000} className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label>
        <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">Expiry<input required type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={create.isPending} className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label>
        <div className="flex items-end"><Button type="submit" loading={create.isPending} loadingLabel="Creating access">Create auditor access</Button></div>
      </form>
      {deliveryUrl ? <div className="mt-4 rounded-lg border border-border bg-canvas p-3"><p className="text-caption-1-semibold text-fg">One-time delivery link</p><p className="mt-1 break-all text-caption-1-regular text-fg-muted">{deliveryUrl}</p><Button type="button" variant="outline" tone="grey" className="mt-3" onClick={() => void copyDeliveryUrl()}>Copy link</Button></div> : null}
      <div className="mt-5 overflow-x-auto"><h4 className="text-subhead-semibold text-fg">Access history</h4>{grants.isPending ? <p role="status" className="mt-2 text-caption-1-regular text-fg-muted">Loading grants…</p> : grants.isError ? <p role="alert" className="mt-2 text-caption-1-regular text-danger">Access history is unavailable. Reload before changing access.</p> : (grants.data?.grants.length ?? 0) === 0 ? <p className="mt-2 text-caption-1-regular text-fg-muted">No auditor access has been granted for this snapshot.</p> : <table className="mt-2 w-full min-w-[640px] text-left text-caption-1-regular text-fg"><thead className="border-b border-border text-caption-1-semibold"><tr><th className="p-2">Recipient</th><th className="p-2">Purpose</th><th className="p-2">Expires</th><th className="p-2">Status</th><th className="p-2"><span className="sr-only">Action</span></th></tr></thead><tbody>{grants.data?.grants.map((grant) => <tr key={grant.id} className="border-b border-border"><td className="p-2">{grant.recipientEmail}</td><td className="p-2">{grant.purpose}</td><td className="p-2">{date(grant.expiresAt)}</td><td className="p-2">{grant.status}</td><td className="p-2">{grant.status === "active" ? <Button type="button" variant="outline" tone="grey" loading={revoke.isPending} onClick={() => void revokeGrant(grant.id, grant.version)}>Revoke</Button> : null}</td></tr>)}</tbody></table>}</div>
    </section>
  );
}
