"use client";

import {
  EVIDENCE_MAX_UPLOAD_BYTES,
  evidenceDocumentClassSchema,
  initializeEvidenceUploadInputSchema,
  type EvidenceDocumentVersion,
} from "@repo/contracts/evidence";
import { Button } from "@repo/ui/button";
import { Download, FileWarning, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import { PageHeading, SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { evidenceApi } from "./evidence.api";
import { useCompleteEvidenceUploadMutation, useEvidenceDocumentsQuery, useInitializeEvidenceUploadMutation } from "./evidence.queries";

type EvidenceDocumentClass = EvidenceDocumentVersion["documentClass"];

const DOCUMENT_CLASSES = Object.freeze([
  ["risk_assessment", "Risk assessment"], ["test_report", "Test report"], ["policy", "Policy"], ["procedure", "Procedure"],
  ["supplier_attestation", "Supplier attestation"], ["certificate", "Certificate"], ["architecture_document", "Architecture document"], ["other", "Other"],
] as const satisfies readonly (readonly [EvidenceDocumentClass, string])[]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "pptx", "csv", "txt"]);

function idempotencyKey() { return crypto.randomUUID(); }
function formatDate(value: string | null) { return value === null ? "Not set" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value)); }
function statusLabel(value: string) { return value.replaceAll("_", " "); }
function errorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403) return "You no longer have permission to manage evidence for this product.";
  if (error instanceof ApiClientError && error.status === 409) return "This upload changed elsewhere. Your entered details are still available to retry.";
  if (error instanceof ApiClientError && (error.kind === "network" || error.kind === "invalid_response" || (error.status ?? 0) >= 500)) return "Evidence services are temporarily unavailable. Your entered details have not been discarded.";
  return error instanceof ApiClientError ? error.message : "The evidence upload could not be completed.";
}

function localFileError(file: File | null): string | null {
  if (!file) return "Choose an evidence file.";
  if (file.size > EVIDENCE_MAX_UPLOAD_BYTES) return "Evidence files must be 50 MiB or smaller.";
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension && ALLOWED_EXTENSIONS.has(extension) ? null : "Choose a PDF, DOCX, XLSX, PPTX, CSV, or TXT file.";
}

export function EvidenceLibrary({ productId }: Readonly<{ productId: string }>) {
  const { session, permissions, isLoading } = useSession();
  const mocksReady = useMocksReady();
  const liveApiEnabled = mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  const canView = permissions.can_view_evidence === true;
  const canUpload = permissions.can_upload_evidence === true;
  const enabled = liveApiEnabled && hasMembership && canView;
  const list = useEvidenceDocumentsQuery(productId, enabled);
  const initialize = useInitializeEvidenceUploadMutation(productId);
  const complete = useCompleteEvidenceUploadMutation(productId);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentClass, setDocumentClass] = useState<EvidenceDocumentClass>("risk_assessment");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const localError = localFileError(file);
    if (localError || !file || !session) { setMessage(localError ?? "Your session is unavailable. Refresh and try again."); return; }
    const key = idempotencyKey();
    const parsed = initializeEvidenceUploadInputSchema.safeParse({
      title, documentClass, ownerUserId: session.user.id, productIds: [productId],
      validFrom: validFrom === "" ? null : new Date(validFrom).toISOString(),
      validUntil: validUntil === "" ? null : new Date(validUntil).toISOString(),
      fileName: file.name, byteSize: file.size, idempotencyKey: key,
    });
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Review the evidence details."); return; }
    setMessage(null); setProgress(null); setUploading(true);
    try {
      const reserved = await initialize.mutateAsync(parsed.data);
      await evidenceApi.uploadOriginal(reserved.upload.uploadUrl, file, setProgress);
      await complete.mutateAsync({ versionId: reserved.document.currentVersion.id, idempotencyKey: key });
      setFile(null); setTitle(""); setValidFrom(""); setValidUntil(""); setProgress(null);
      setMessage("Evidence is uploaded and awaiting malware scanning. It cannot be used until clean.");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setUploading(false); }
  }

  async function download(documentId: string, versionId: string) {
    try { const response = await evidenceApi.download(documentId, versionId); window.location.assign(response.download.downloadUrl); }
    catch (error) { setMessage(errorMessage(error)); }
  }

  return <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
    <PageHeading title="Evidence library" subtitle="Private, tenant-scoped evidence for this product. Files become usable only after a clean scan." />
    {!liveApiEnabled ? <SectionCard><p className="text-subhead-regular text-fg-muted">Evidence is available when the live backend is enabled.</p></SectionCard>
    : isLoading ? <SectionCard><p role="status" className="text-subhead-regular text-fg-muted">Loading evidence access…</p></SectionCard>
    : !hasMembership ? <SectionCard><p className="text-subhead-regular text-fg-muted">Create or join an organization before managing evidence.</p></SectionCard>
    : !canView ? <SectionCard><p className="text-subhead-regular text-fg-muted">You do not have access to this product’s evidence library.</p></SectionCard>
    : <>
      {canUpload ? <SectionCard title="Upload evidence"><form onSubmit={upload} noValidate className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-1 text-caption-1-semibold text-fg">Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} required className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">Evidence class<select value={documentClass} onChange={(event) => setDocumentClass(evidenceDocumentClassSchema.parse(event.target.value))} className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus">{DOCUMENT_CLASSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <p className="text-caption-1-regular text-fg-muted">Owner: {session?.user.email ?? "Current member"}. Ownership is recorded with this immutable version.</p>
        <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-1 text-caption-1-semibold text-fg">Valid from<input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label><label className="grid gap-1 text-caption-1-semibold text-fg">Valid until<input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label></div>
        <label className="grid gap-1 text-caption-1-semibold text-fg">Original file<input type="file" accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt,application/pdf,text/csv,text/plain" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required className="block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-2 file:py-1 file:text-caption-1-semibold" /><span className="text-caption-1-regular text-fg-muted">PDF, Office, CSV, or TXT; up to 50 MiB. The server verifies actual bytes before scanning.</span></label>
        <div><Button type="submit" loading={uploading} loadingLabel="Uploading evidence"><Upload aria-hidden="true" />Upload evidence</Button>{progress !== null ? <span role="status" className="ml-3 text-caption-1-regular text-fg-muted">{Math.round(progress * 100)}% uploaded</span> : null}</div>
      </form></SectionCard> : null}
      {message ? <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-subhead-regular text-fg">{message}</p> : null}
      <SectionCard title="Evidence records">{list.isLoading ? <p role="status" className="text-subhead-regular text-fg-muted">Loading evidence records…</p> : list.isError ? <div className="grid gap-3"><p className="text-subhead-regular text-fg-muted">Evidence records could not be loaded.</p><Button type="button" variant="outline" tone="grey" onClick={() => void list.refetch()}>Retry</Button></div> : list.data?.items.length === 0 ? <p className="text-subhead-regular text-fg-muted">No evidence has been uploaded for this product.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-border text-caption-1-semibold text-fg-muted"><tr><th className="px-3 py-2">Document</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Validity</th><th className="px-3 py-2">SHA-256</th><th className="px-3 py-2">Links</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>{list.data?.items.map(({ document, linkageCount }) => { const version = document.currentVersion; const clean = version.status === "clean"; return <tr key={document.id} className="border-b border-border align-top"><td className="px-3 py-3"><p className="text-subhead-semibold text-fg">{version.title}</p><p className="text-caption-1-regular text-fg-muted">{version.fileName} · v{version.versionNumber}</p></td><td className="px-3 py-3"><span className="inline-flex items-center gap-1 text-caption-1-semibold text-fg">{clean ? <ShieldCheck aria-hidden="true" className="size-4" /> : <FileWarning aria-hidden="true" className="size-4" />}{statusLabel(version.status)}</span></td><td className="px-3 py-3 text-caption-1-regular text-fg-muted">{formatDate(version.validFrom)} – {formatDate(version.validUntil)}</td><td className="px-3 py-3 font-mono text-caption-1-regular text-fg-muted">{version.sha256 ? `${version.sha256.slice(0, 12)}…` : "Pending"}</td><td className="px-3 py-3 text-caption-1-regular text-fg-muted">{linkageCount}</td><td className="px-3 py-3">{clean ? <Button type="button" variant="outline" tone="grey" onClick={() => void download(document.id, version.id)}><Download aria-hidden="true" />Download</Button> : <span className="text-caption-1-regular text-fg-muted">Unavailable until clean</span>}</td></tr>; })}</tbody></table></div>}</SectionCard>
    </>}
  </div>;
}
