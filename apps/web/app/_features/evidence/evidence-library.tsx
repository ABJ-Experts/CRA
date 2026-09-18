"use client";

import {
  EVIDENCE_MAX_UPLOAD_BYTES,
  createEvidenceReplacementInputSchema,
  evidenceDocumentClassSchema,
  initializeEvidenceUploadInputSchema,
  type EvidenceDocument,
  type EvidenceDocumentVersion,
} from "@repo/contracts/evidence";
import { Button } from "@repo/ui/button";
import {
  Download,
  Eye,
  FileWarning,
  Replace,
  ShieldCheck,
  Upload,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import {
  PageHeading,
  SectionCard,
} from "../../dashboard/_components/dashboard-chrome";
import { evidenceApi } from "./evidence.api";
import { EvidenceExtractedText } from "./evidence-extracted-text";
import {
  useCompleteEvidenceUploadMutation,
  useEvidenceDocumentsQuery,
  useEvidenceVersionsQuery,
  useInitializeEvidenceUploadMutation,
  useReplaceEvidenceMutation,
} from "./evidence.queries";

const EvidenceSearchPanel = dynamic(
  () =>
    import("./evidence-search-panel").then(
      (module) => module.EvidenceSearchPanel,
    ),
  {
    loading: () => (
      <p
        role="status"
        className="rounded-xl border border-border bg-surface p-4 text-caption-1-regular text-fg-muted"
      >
        Loading evidence search…
      </p>
    ),
  },
);

type DocumentClass = EvidenceDocumentVersion["documentClass"];
type Mode = "new" | "replacement";
type Delivery = Readonly<{
  url: string;
  mediaType: string;
  fileName: string;
  previewSupported: boolean;
}>;

const CLASSES = [
  ["risk_assessment", "Risk assessment"],
  ["test_report", "Test report"],
  ["policy", "Policy"],
  ["procedure", "Procedure"],
  ["supplier_attestation", "Supplier attestation"],
  ["certificate", "Certificate"],
  ["architecture_document", "Architecture document"],
  ["other", "Other"],
] as const satisfies readonly (readonly [DocumentClass, string])[];
const EXTENSIONS = new Set([
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
const PREVIEW_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const requestId = () => crypto.randomUUID();
const label = (value: string) => value.replaceAll("_", " ");
const date = (value: string | null) =>
  value === null
    ? "Not set"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
        new Date(value),
      );
function fileError(file: File | null) {
  if (!file) return "Choose an evidence file.";
  if (file.size > EVIDENCE_MAX_UPLOAD_BYTES)
    return "Evidence files must be 50 MiB or smaller.";
  return EXTENSIONS.has(file.name.split(".").pop()?.toLowerCase() ?? "")
    ? null
    : "Choose a supported document, PDF, or image file.";
}
function errorText(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to access this evidence.";
  if (error instanceof ApiClientError && error.status === 404)
    return "That evidence version is unavailable for this product.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This document changed elsewhere. Your entered replacement details are preserved; refresh the current version and retry.";
  if (error instanceof ApiClientError && error.status === 410)
    return "This verified delivery link expired. Request access again.";
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status ?? 0) >= 500)
  )
    return "Evidence services are temporarily unavailable. Your entered details have not been discarded.";
  return error instanceof ApiClientError
    ? error.message
    : "The evidence request could not be completed.";
}

export function EvidenceLibrary({
  productId,
}: Readonly<{ productId: string }>) {
  const { session, permissions, isLoading } = useSession();
  const live =
    useMocksReady() && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const member = (session?.organizations.length ?? 0) > 0;
  const canView = permissions.can_view_evidence === true;
  const canUpload = permissions.can_upload_evidence === true;
  const enabled = live && member && canView;
  const list = useEvidenceDocumentsQuery(productId, enabled);
  const initialize = useInitializeEvidenceUploadMutation(productId);
  const replace = useReplaceEvidenceMutation(productId);
  const complete = useCompleteEvidenceUploadMutation(productId);
  const [selected, setSelected] = useState<EvidenceDocument | null>(null);
  const versions = useEvidenceVersionsQuery(
    productId,
    selected?.id ?? null,
    enabled,
  );
  const [versionId, setVersionId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentClass, setDocumentClass] =
    useState<DocumentClass>("risk_assessment");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const selectedVersion =
    versions.data?.versions.find((version) => version.id === versionId) ??
    selected?.currentVersion ??
    null;

  useEffect(() => {
    if (selected) {
      setVersionId(selected.currentVersionId);
      setDelivery(null);
    }
  }, [selected]);
  useEffect(() => {
    if (
      versions.data &&
      versionId &&
      !versions.data.versions.some((version) => version.id === versionId)
    )
      setVersionId(versions.data.versions[0]?.id ?? null);
  }, [versionId, versions.data]);

  function replaceDocument(document: EvidenceDocument) {
    setSelected(document);
    setMode("replacement");
    setTitle(document.currentVersion.title);
    setDocumentClass(document.currentVersion.documentClass);
    setValidFrom(document.currentVersion.validFrom?.slice(0, 10) ?? "");
    setValidUntil(document.currentVersion.validUntil?.slice(0, 10) ?? "");
    setMessage(
      "The replacement will be appended as a new immutable version. Existing versions and version-pinned links are unchanged.",
    );
  }
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issue = fileError(file);
    if (issue || !file || !session) {
      setMessage(
        issue ?? "Your session is unavailable. Refresh and try again.",
      );
      return;
    }
    const idempotencyKey = requestId();
    const fields = {
      title,
      documentClass,
      ownerUserId: session.user.id,
      productIds: [productId],
      validFrom: validFrom ? new Date(validFrom).toISOString() : null,
      validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      fileName: file.name,
      byteSize: file.size,
      idempotencyKey,
    };
    const parsed =
      mode === "replacement" && selected
        ? createEvidenceReplacementInputSchema.safeParse({
            ...fields,
            documentId: selected.id,
            expectedCurrentVersionId: selected.currentVersionId,
          })
        : initializeEvidenceUploadInputSchema.safeParse(fields);
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Review the evidence details.",
      );
      return;
    }
    setMessage(null);
    setProgress(null);
    setUploading(true);
    try {
      const reserved =
        mode === "replacement" && selected
          ? await replace.mutateAsync(
              createEvidenceReplacementInputSchema.parse(parsed.data),
            )
          : await initialize.mutateAsync(
              initializeEvidenceUploadInputSchema.parse(parsed.data),
            );
      await evidenceApi.uploadOriginal(
        reserved.upload.uploadUrl,
        file,
        setProgress,
      );
      await complete.mutateAsync({
        versionId: reserved.document.currentVersion.id,
        idempotencyKey,
      });
      setFile(null);
      setTitle("");
      setValidFrom("");
      setValidUntil("");
      setProgress(null);
      setMode("new");
      setSelected(reserved.document);
      setMessage(
        "Evidence is uploaded and awaiting malware scanning. It cannot be viewed or downloaded until clean.",
      );
    } catch (error) {
      setMessage(errorText(error));
      if (error instanceof ApiClientError && error.status === 409 && selected) {
        const refreshed = await list.refetch();
        const current = refreshed.data?.items.find(
          ({ document }) => document.id === selected.id,
        )?.document;
        if (current) setSelected(current);
      }
    } finally {
      setUploading(false);
    }
  }
  async function access(disposition: "inline" | "attachment") {
    if (!selected || !selectedVersion) return;
    setMessage(null);
    try {
      const response = await evidenceApi.access(
        productId,
        selected.id,
        selectedVersion.id,
        { disposition },
      );
      if (disposition === "attachment") {
        const anchor = document.createElement("a");
        anchor.href = response.access.deliveryUrl;
        anchor.download = response.access.fileName;
        anchor.referrerPolicy = "no-referrer";
        anchor.rel = "noreferrer";
        anchor.click();
        setMessage(
          "Verified download delivery started. Authorization is recorded separately from browser receipt.",
        );
      } else
        setDelivery({
          url: response.access.deliveryUrl,
          mediaType: response.access.mediaType,
          fileName: response.access.fileName,
          previewSupported: response.access.previewSupported,
        });
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  const uploadForm = canUpload ? (
    <SectionCard
      title={
        mode === "replacement"
          ? "Append replacement version"
          : "Upload evidence"
      }
    >
      <form onSubmit={upload} noValidate className="grid gap-4">
        {mode === "replacement" && selected ? (
          <p className="text-subhead-regular text-fg-muted">
            Appending to {selected.currentVersion.fileName} as the next version.{" "}
            <button
              type="button"
              className="font-medium text-active-500 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              onClick={() => setMode("new")}
            >
              Cancel replacement
            </button>
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={500}
              required
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Evidence class
            <select
              value={documentClass}
              onChange={(event) =>
                setDocumentClass(
                  evidenceDocumentClassSchema.parse(event.target.value),
                )
              }
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {CLASSES.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-caption-1-regular text-fg-muted">
          Owner: {session?.user.email ?? "Current member"}. Ownership is
          recorded with this immutable version.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Valid from
            <input
              type="date"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Valid until
            <input
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
        </div>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Original file
          <input
            type="file"
            accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp,text/csv,text/plain"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            className="block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-2 file:py-1 file:text-caption-1-semibold"
          />
          <span className="text-caption-1-regular text-fg-muted">
            PDF, supported Office document, text, or image; up to 50 MiB. The
            server verifies actual bytes before scanning.
          </span>
        </label>
        <div>
          <Button
            type="submit"
            loading={uploading}
            loadingLabel="Uploading evidence"
          >
            <Upload aria-hidden="true" />
            {mode === "replacement" ? "Append version" : "Upload evidence"}
          </Button>
          {progress !== null ? (
            <span
              role="status"
              className="ml-3 text-caption-1-regular text-fg-muted"
            >
              {Math.round(progress * 100)}% uploaded
            </span>
          ) : null}
        </div>
      </form>
    </SectionCard>
  ) : null;
  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title="Evidence library"
        subtitle="Private, tenant-scoped evidence for this product. Files become usable only after a clean scan."
      />
      {!live ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Evidence is available when the live backend is enabled.
          </p>
        </SectionCard>
      ) : isLoading ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading evidence access…
          </p>
        </SectionCard>
      ) : !member ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Create or join an organization before managing evidence.
          </p>
        </SectionCard>
      ) : !canView ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            You do not have access to this product’s evidence library.
          </p>
        </SectionCard>
      ) : (
        <>
          {uploadForm}
          {message ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-surface px-4 py-3 text-subhead-regular text-fg"
            >
              {message}
            </p>
          ) : null}
          <EvidenceSearchPanel productId={productId} enabled={enabled} />
          <SectionCard title="Evidence records">
            {list.isLoading ? (
              <p role="status" className="text-subhead-regular text-fg-muted">
                Loading evidence records…
              </p>
            ) : list.isError ? (
              <div className="grid gap-3">
                <p className="text-subhead-regular text-fg-muted">
                  Evidence records could not be loaded.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void list.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : list.data?.items.length === 0 ? (
              <p className="text-subhead-regular text-fg-muted">
                No evidence has been uploaded for this product.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="border-b border-border text-caption-1-semibold text-fg-muted">
                    <tr>
                      <th className="px-3 py-2">Document</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Validity</th>
                      <th className="px-3 py-2">SHA-256</th>
                      <th className="px-3 py-2">Links</th>
                      <th className="px-3 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data?.items.map(({ document, linkageCount }) => {
                      const version = document.currentVersion;
                      const clean = version.status === "clean";
                      return (
                        <tr
                          key={document.id}
                          className="border-b border-border align-top"
                        >
                          <td className="px-3 py-3">
                            <p className="text-subhead-semibold text-fg">
                              {version.title}
                            </p>
                            <p className="text-caption-1-regular text-fg-muted">
                              {version.fileName} · v{version.versionNumber}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-1 text-caption-1-semibold text-fg">
                              {clean ? (
                                <ShieldCheck
                                  aria-hidden="true"
                                  className="size-4"
                                />
                              ) : (
                                <FileWarning
                                  aria-hidden="true"
                                  className="size-4"
                                />
                              )}
                              {label(version.status)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-caption-1-regular text-fg-muted">
                            {date(version.validFrom)} –{" "}
                            {date(version.validUntil)}
                          </td>
                          <td className="px-3 py-3 font-mono text-caption-1-regular text-fg-muted">
                            {version.sha256
                              ? `${version.sha256.slice(0, 12)}…`
                              : "Pending"}
                          </td>
                          <td className="px-3 py-3 text-caption-1-regular text-fg-muted">
                            {linkageCount}
                          </td>
                          <td className="px-3 py-3">
                            <Button
                              type="button"
                              variant="outline"
                              tone="grey"
                              onClick={() => setSelected(document)}
                            >
                              <Eye aria-hidden="true" />
                              View versions
                            </Button>
                            {canUpload ? (
                              <Button
                                type="button"
                                variant="invisible"
                                tone="grey"
                                className="mt-2"
                                onClick={() => replaceDocument(document)}
                              >
                                <Replace aria-hidden="true" />
                                Replace
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          {selected ? (
            <SectionCard title="Verified version viewer">
              <div className="grid gap-4 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
                <div className="grid content-start gap-3">
                  <label className="grid gap-1 text-caption-1-semibold text-fg">
                    Version
                    <select
                      value={versionId ?? ""}
                      onChange={(event) => {
                        setVersionId(event.target.value);
                        setDelivery(null);
                      }}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {versions.isLoading ? (
                        <option>Loading versions…</option>
                      ) : (
                        versions.data?.versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            Version {version.versionNumber} ·{" "}
                            {label(version.status)}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  {versions.isError ? (
                    <div className="grid gap-2">
                      <p className="text-subhead-regular text-fg-muted">
                        Version history could not be loaded.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        tone="grey"
                        onClick={() => void versions.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}
                  {selectedVersion ? (
                    <>
                      <p className="text-subhead-regular text-fg">
                        {selectedVersion.fileName}
                      </p>
                      <p className="text-caption-1-regular text-fg-muted">
                        SHA-256:{" "}
                        {selectedVersion.sha256 ?? "Pending verification"}
                      </p>
                      <p className="text-caption-1-regular text-fg-muted">
                        Created {date(selectedVersion.createdAt)}
                      </p>
                      <EvidenceExtractedText
                        productId={productId}
                        documentId={selected.id}
                        version={selectedVersion}
                        enabled={enabled}
                        canRetry={canUpload}
                      />
                      {selectedVersion.status !== "clean" ? (
                        <p className="text-subhead-regular text-fg-muted">
                          This version is {label(selectedVersion.status)} and
                          cannot be viewed or downloaded.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            tone="grey"
                            onClick={() => void access("inline")}
                          >
                            <Eye aria-hidden="true" />
                            Preview
                          </Button>
                          <Button
                            type="button"
                            onClick={() => void access("attachment")}
                          >
                            <Download aria-hidden="true" />
                            Download
                          </Button>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
                <div className="min-h-72 rounded-xl border border-border bg-surface p-3">
                  {!selectedVersion ? (
                    <p className="text-subhead-regular text-fg-muted">
                      Choose an evidence version to review.
                    </p>
                  ) : selectedVersion.status !== "clean" ? (
                    <p className="text-subhead-regular text-fg-muted">
                      Verified previews are available only for clean versions.
                    </p>
                  ) : !delivery ? (
                    <p className="text-subhead-regular text-fg-muted">
                      Request a verified preview. Preview access expires after
                      five minutes.
                    </p>
                  ) : !delivery.previewSupported ||
                    !PREVIEW_TYPES.has(delivery.mediaType) ? (
                    <p className="text-subhead-regular text-fg-muted">
                      Preview is not supported for this verified file. Use the
                      safe download action instead.
                    </p>
                  ) : delivery.mediaType === "application/pdf" ? (
                    <iframe
                      title={`Preview of ${delivery.fileName}`}
                      src={delivery.url}
                      sandbox="allow-same-origin"
                      referrerPolicy="no-referrer"
                      className="h-[32rem] w-full rounded-lg border border-border bg-canvas"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- verified delivery must bypass Next's image cache.
                    <img
                      src={delivery.url}
                      alt={`Preview of ${delivery.fileName}`}
                      referrerPolicy="no-referrer"
                      className="max-h-[32rem] w-full object-contain"
                    />
                  )}
                </div>
              </div>
            </SectionCard>
          ) : null}
        </>
      )}
    </div>
  );
}
