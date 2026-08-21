"use client";

import {
  SBOM_MAX_UPLOAD_BYTES,
  sbomMediaTypeSchema,
  type SbomJob,
  type SbomDetectedFormat,
  type SbomSource,
  type SbomSourceHistoryItem,
  type SbomValidationDiagnostic,
  type SbomValidationDiagnosticSeverity,
  type SbomValidationReport,
  type SbomValidationStatus,
} from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Select, SelectItem } from "@repo/ui/select";
import { Tag, type TagProps } from "@repo/ui/tag";
import { Download, RotateCcw, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { sbomsApi } from "../../_features/sboms/sboms.api";
import {
  useSbomJobQuery,
  useSbomSourceHistoryQuery,
  useSbomValidationReportQuery,
} from "../../_features/sboms/sboms.queries";

type ReleaseOption = Readonly<{ id: string; label: string; version: string }>;
type UploadPhase =
  "idle" | "hashing" | "reserving" | "uploading" | "completing";
type DiagnosticFilter = "all" | SbomValidationDiagnosticSeverity;

const ACCEPTED_SBOM_TYPES = Object.freeze(sbomMediaTypeSchema.options);
const ACCEPTED_SBOM_EXTENSIONS = Object.freeze([
  ".json",
  ".xml",
  ".txt",
  ".spdx",
  ".cdx",
  ".sbom",
] as const);
const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_SBOM_TYPES,
  ...ACCEPTED_SBOM_EXTENSIONS,
].join(",");
const DEFAULT_HISTORY_LIMIT = 10;
const ZERO_COUNTS = Object.freeze({ error: 0, warning: 0 });

function requestId(): string {
  return crypto.randomUUID();
}

async function sha256(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot securely calculate a file checksum.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await fileBytes(file),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function fileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error("Read failed"));
    };
    reader.readAsArrayBuffer(file);
  });
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function jobStatusLabel(status: SbomJob["status"]): string {
  return titleCase(status);
}

function validationStatusLabel(status: SbomValidationStatus): string {
  if (status === "valid_with_warnings") return "Valid with warnings";
  return titleCase(status);
}

function sourceStatusLabel(status: SbomSource["status"]): string {
  if (status === "upload_pending") return "Upload pending";
  return titleCase(status);
}

function tagToneForValidation(status: SbomValidationStatus): TagProps["tone"] {
  if (status === "valid") return "green";
  if (status === "valid_with_warnings") return "orange";
  if (status === "invalid") return "red";
  return "blue";
}

function tagToneForSource(status: SbomSource["status"]): TagProps["tone"] {
  if (status === "verified") return "green";
  if (status === "rejected") return "red";
  if (status === "expired") return "orange";
  return "blue";
}

function tagToneForJob(status: SbomJob["status"]): TagProps["tone"] {
  if (status === "completed") return "green";
  if (status === "failed" || status === "dead_letter") return "red";
  return "blue";
}

function detectedName(format: SbomDetectedFormat | null): string {
  if (format === "cyclonedx") return "CycloneDX";
  if (format === "spdx") return "SPDX";
  return "Undetected";
}

function detectedSummary(
  report: SbomValidationReport | null,
  source: SbomSource | null,
): string {
  const format = report?.detected?.format ?? source?.declaredFormat ?? null;
  const version =
    report?.detected?.specificationVersion ??
    source?.declaredSpecVersion ??
    null;
  return [detectedName(format), version].filter(Boolean).join(" ");
}

function declaredMediaType(file: File): string {
  return file.type || "application/octet-stream";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You no longer have permission to upload SBOM evidence.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "That product release is unavailable.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  ) {
    return "The SBOM service is temporarily unavailable. Your file was not marked complete; try completing the same upload again.";
  }
  return error instanceof ApiClientError
    ? error.message
    : "The SBOM could not be uploaded.";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You no longer have permission to view SBOM evidence.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "That SBOM evidence is unavailable.";
  }
  return "SBOM evidence is temporarily degraded. Retry the view in a moment.";
}

function validateFile(file: File): string | null {
  if (file.size < 1) return "Choose a non-empty SBOM file.";
  if (file.size > SBOM_MAX_UPLOAD_BYTES)
    return "SBOM files must be 100 MiB or smaller.";
  if (!sbomMediaTypeSchema.safeParse(declaredMediaType(file)).success) {
    return "Choose a JSON, XML, or supported SBOM media type.";
  }
  return null;
}

function triggerDownload(
  download: Readonly<{ downloadUrl: string; fileName: string }>,
) {
  const anchor = document.createElement("a");
  anchor.href = download.downloadUrl;
  anchor.download = download.fileName;
  anchor.rel = "noreferrer";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function filterDiagnostics(
  diagnostics: readonly SbomValidationDiagnostic[],
  filter: DiagnosticFilter,
): readonly SbomValidationDiagnostic[] {
  return filter === "all"
    ? diagnostics
    : diagnostics.filter((diagnostic) => diagnostic.severity === filter);
}

function diagnosticFilterLabel(
  filter: DiagnosticFilter,
  count: number,
): string {
  if (filter === "all") return `All ${count}`;
  return `${titleCase(filter)}s ${count}`;
}

export function SbomIntakeSection({
  productId,
  releases,
  canView,
  canUpload,
  canReplay,
  enabled,
}: Readonly<{
  productId: string;
  releases: readonly ReleaseOption[];
  canView: boolean;
  canUpload: boolean;
  canReplay: boolean;
  enabled: boolean;
}>) {
  const [releaseId, setReleaseId] = useState(releases[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<SbomSource | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [correctionSourceId, setCorrectionSourceId] = useState<string | null>(
    null,
  );
  const [diagnosticFilter, setDiagnosticFilter] =
    useState<DiagnosticFilter>("all");
  const [pendingCompletion, setPendingCompletion] = useState<Readonly<{
    sourceId: string;
    idempotencyKey: string;
  }> | null>(null);
  const [job, setJob] = useState<SbomJob | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const sourceHistoryQuery = useSbomSourceHistoryQuery(
    productId,
    releaseId,
    { limit: DEFAULT_HISTORY_LIMIT },
    enabled && canView && releaseId !== "",
  );
  const sourceItems = useMemo(
    () => sourceHistoryQuery.data?.sources ?? [],
    [sourceHistoryQuery.data?.sources],
  );
  const selectedHistoryItem =
    sourceItems.find((item) => item.source.id === selectedSourceId) ??
    sourceItems[0] ??
    null;
  const effectiveSourceId =
    selectedSourceId ?? selectedHistoryItem?.source.id ?? null;
  const reportQuery = useSbomValidationReportQuery(
    effectiveSourceId,
    enabled && canView && effectiveSourceId !== null,
  );
  const jobQuery = useSbomJobQuery(job?.id ?? null, enabled && canView);

  useEffect(() => {
    if (releases.some((release) => release.id === releaseId)) return;
    setReleaseId(releases[0]?.id ?? "");
  }, [releaseId, releases]);

  useEffect(() => {
    setCorrectionSourceId(null);
    setDiagnosticFilter("all");
  }, [releaseId]);

  useEffect(() => {
    if (sourceItems.length === 0) {
      setSelectedSourceId(null);
      return;
    }
    if (
      selectedSourceId &&
      sourceItems.some((item) => item.source.id === selectedSourceId)
    ) {
      return;
    }
    setSelectedSourceId(sourceItems[0]?.source.id ?? null);
  }, [selectedSourceId, sourceItems]);

  const currentJob = jobQuery.data?.job ?? job;
  const busy = phase !== "idle";
  const selectedRelease = releases.find((release) => release.id === releaseId);
  const report = reportQuery.data?.report ?? null;
  const reportSource =
    reportQuery.data?.source ?? selectedHistoryItem?.source ?? source;
  const selectedSummary = selectedHistoryItem?.validation ?? null;
  const diagnosticCounts = report
    ? { error: report.errorCount, warning: report.warningCount }
    : selectedSummary
      ? {
          error: selectedSummary.errorCount,
          warning: selectedSummary.warningCount,
        }
      : ZERO_COUNTS;
  const diagnostics = report?.diagnostics ?? [];
  const visibleDiagnostics = filterDiagnostics(diagnostics, diagnosticFilter);
  const totalDiagnostics = diagnosticCounts.error + diagnosticCounts.warning;
  const validationStatus =
    report?.status ?? selectedSummary?.status ?? "pending";
  const uploadStatus = useMemo(() => {
    if (phase === "hashing") return "Calculating SHA-256...";
    if (phase === "reserving") return "Reserving immutable evidence...";
    if (phase === "uploading") {
      return progress === null
        ? "Uploading to secure storage..."
        : `Uploading to secure storage... ${Math.round(progress * 100)}%`;
    }
    if (phase === "completing") return "Verifying original evidence...";
    return null;
  }, [phase, progress]);
  const uploadButtonLabel = correctionSourceId
    ? "Upload corrected SBOM"
    : "Upload SBOM";

  async function completePendingUpload(
    sourceId: string,
    idempotencyKey: string,
  ) {
    setPhase("completing");
    const completed = await sbomsApi.completeUpload(sourceId, {
      idempotencyKey,
    });
    setJob(completed.job);
    setPendingCompletion(null);
    setFile(null);
    setCorrectionSourceId(null);
    setMessage("Original evidence is verified and queued for processing.");
    await sourceHistoryQuery.refetch();
  }

  async function upload() {
    if (!file || !selectedRelease) return;
    const invalid = validateFile(file);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    const mediaType = sbomMediaTypeSchema.parse(declaredMediaType(file));

    const idempotencyKey = requestId();
    setMessage(null);
    setProgress(null);
    try {
      setPhase("hashing");
      const hash = await sha256(file);
      setPhase("reserving");
      const initialized = await sbomsApi.initializeUpload({
        productId,
        releaseId: selectedRelease.id,
        fileName: file.name,
        mediaType,
        byteSize: file.size,
        sha256: hash,
        idempotencyKey,
        supersedesSourceId: correctionSourceId ?? undefined,
      });
      setSource(initialized.source);
      setSelectedSourceId(initialized.source.id);
      setPhase("uploading");
      await sbomsApi.uploadOriginal(
        initialized.upload.uploadUrl,
        file,
        setProgress,
      );
      setPendingCompletion({ sourceId: initialized.source.id, idempotencyKey });
      await completePendingUpload(initialized.source.id, idempotencyKey);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  async function completeExistingUpload() {
    if (!pendingCompletion) return;
    setMessage(null);
    try {
      await completePendingUpload(
        pendingCompletion.sourceId,
        pendingCompletion.idempotencyKey,
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPhase("idle");
    }
  }

  async function downloadOriginal() {
    if (!reportSource) return;
    setDownloading(true);
    setMessage(null);
    try {
      triggerDownload(
        await sbomsApi
          .downloadOriginal(reportSource.id)
          .then((response) => response.download),
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setDownloading(false);
    }
  }

  async function replay() {
    if (!currentJob) return;
    setReplaying(true);
    setMessage(null);
    try {
      const response = await sbomsApi.replayJob(currentJob.id, {
        idempotencyKey: requestId(),
      });
      setJob(response.job);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setReplaying(false);
    }
  }

  function beginCorrection(sourceId: string) {
    setCorrectionSourceId(sourceId);
    setFile(null);
    setMessage(
      "Choose a corrected SBOM. The previous evidence remains immutable.",
    );
  }

  return (
    <section
      aria-labelledby="sbom-evidence-heading"
      className="w-full min-w-0 max-w-full rounded-xl border border-border bg-canvas p-4 sm:p-6"
    >
      <div className="flex min-w-0 max-w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id="sbom-evidence-heading"
            className="text-title-semibold text-fg"
          >
            SBOM evidence
          </h2>
          <p className="mt-1 max-w-3xl text-subhead-regular text-fg-muted">
            Preserve the exact original and queue it for secure intake. Parsed
            validation results stay linked to immutable evidence sources.
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">
          {currentJob ? (
            <Tag
              variant="dot"
              tone={tagToneForJob(currentJob.status)}
              size="sm"
            >
              {jobStatusLabel(currentJob.status)}
            </Tag>
          ) : null}
          {reportSource ? (
            <Tag
              variant="dot"
              tone={tagToneForSource(reportSource.status)}
              size="sm"
            >
              {sourceStatusLabel(reportSource.status)}
            </Tag>
          ) : null}
        </div>
      </div>

      {!canView ? (
        <p role="alert" className="mt-4 text-subhead-regular text-danger">
          You do not have permission to view SBOM evidence.
        </p>
      ) : releases.length === 0 ? (
        <p className="mt-4 text-subhead-regular text-fg-muted">
          Create a product release before uploading SBOM evidence.
        </p>
      ) : (
        <div className="mt-5 grid min-w-0 max-w-full gap-4">
          <Select
            label="Release"
            value={releaseId}
            onValueChange={setReleaseId}
            disabled={busy}
            wrapperClassName="min-w-0 max-w-full sm:max-w-md"
            aria-label="Release"
          >
            {releases.map((release) => (
              <SelectItem key={release.id} value={release.id}>
                {release.label} - {release.version}
              </SelectItem>
            ))}
          </Select>
          {canUpload ? (
            <div className="grid min-w-0 max-w-full gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="flex min-w-0 max-w-full flex-col gap-2 text-caption-1-semibold text-fg-muted">
                SBOM file
                <input
                  id="sbom-file"
                  name="sbom-file"
                  aria-label="SBOM file"
                  type="file"
                  accept={ACCEPT_ATTRIBUTE}
                  disabled={busy}
                  onChange={(event) => {
                    const nextFile = event.currentTarget.files?.[0] ?? null;
                    setFile(nextFile);
                    setMessage(nextFile ? validateFile(nextFile) : null);
                  }}
                  className="min-h-10 w-full min-w-0 max-w-full rounded-xl border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-2 file:py-1 file:text-caption-1-semibold file:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                />
              </label>
              <Button
                type="button"
                className="w-full sm:w-auto"
                startIcon={<UploadCloud aria-hidden="true" />}
                disabled={!file || busy}
                loading={busy}
                loadingLabel={uploadStatus ?? "Uploading SBOM"}
                onClick={() => void upload()}
              >
                {uploadButtonLabel}
              </Button>
            </div>
          ) : (
            <p className="text-caption-1-regular text-fg-muted">
              You can view SBOM evidence, but do not have permission to upload
              it.
            </p>
          )}
          <p className="text-caption-1-regular text-fg-muted">
            JSON, XML, text, approved SBOM media types, and unknown browser file
            types are accepted. Unknown types are declared as
            application/octet-stream. Maximum size: 100 MiB.
          </p>
          {uploadStatus ? (
            <p role="status" className="text-caption-1-regular text-fg">
              {uploadStatus}
            </p>
          ) : null}
          {message ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              {message}
            </p>
          ) : null}
          {pendingCompletion ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              className="w-full sm:w-fit"
              disabled={busy}
              loading={phase === "completing"}
              loadingLabel="Verifying original evidence"
              onClick={() => void completeExistingUpload()}
            >
              Complete uploaded file
            </Button>
          ) : null}
          {currentJob ? (
            <JobStatusPanel
              job={currentJob}
              canReplay={canReplay}
              replaying={replaying}
              onReplay={() => void replay()}
            />
          ) : null}
          <div className="grid min-w-0 max-w-full gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <SourceHistoryPanel
              isLoading={sourceHistoryQuery.isPending}
              isError={sourceHistoryQuery.isError}
              error={sourceHistoryQuery.error}
              sources={sourceItems}
              selectedSourceId={reportSource?.id ?? null}
              onSelect={(nextSourceId) => {
                setSelectedSourceId(nextSourceId);
                setDiagnosticFilter("all");
              }}
            />
            <ReportPanel
              source={reportSource}
              report={report}
              validationStatus={validationStatus}
              selectedSummary={selectedSummary}
              reportLoading={reportQuery.isPending}
              reportError={reportQuery.isError}
              error={reportQuery.error}
              diagnosticCounts={diagnosticCounts}
              totalDiagnostics={totalDiagnostics}
              diagnosticFilter={diagnosticFilter}
              visibleDiagnostics={visibleDiagnostics}
              omittedDiagnosticCount={report?.omittedDiagnosticCount ?? 0}
              canUpload={canUpload}
              downloading={downloading}
              onFilter={setDiagnosticFilter}
              onDownload={() => void downloadOriginal()}
              onCorrect={
                reportSource
                  ? () => beginCorrection(reportSource.id)
                  : undefined
              }
              correctionSourceId={correctionSourceId}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function JobStatusPanel({
  job,
  canReplay,
  replaying,
  onReplay,
}: Readonly<{
  job: SbomJob;
  canReplay: boolean;
  replaying: boolean;
  onReplay: () => void;
}>) {
  return (
    <div
      aria-live="polite"
      className="min-w-0 max-w-full rounded-xl border border-border bg-surface-subtle p-4"
    >
      <p className="text-subhead-semibold text-fg">{job.progress.message}</p>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        {job.progress.percent}% complete - attempt {job.attempts} of{" "}
        {job.maxAttempts}
      </p>
      {job.error ? (
        <p role="alert" className="mt-2 text-caption-1-regular text-danger">
          {job.error.retryable ? "Retryable: " : ""}
          {job.error.message}
        </p>
      ) : null}
      {canReplay && job.status === "dead_letter" ? (
        <Button
          type="button"
          variant="outline"
          tone="grey"
          className="mt-3 w-full sm:w-fit"
          startIcon={<RotateCcw aria-hidden="true" />}
          loading={replaying}
          loadingLabel="Replaying job"
          onClick={onReplay}
        >
          Replay intake job
        </Button>
      ) : null}
    </div>
  );
}

function SourceHistoryPanel({
  isLoading,
  isError,
  error,
  sources,
  selectedSourceId,
  onSelect,
}: Readonly<{
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  sources: readonly SbomSourceHistoryItem[];
  selectedSourceId: string | null;
  onSelect: (sourceId: string) => void;
}>) {
  return (
    <div className="min-w-0 max-w-full rounded-xl border border-border bg-surface-subtle p-3">
      <div className="flex min-w-0 max-w-full items-center justify-between gap-3">
        <p className="text-caption-1-semibold text-fg">Source history</p>
        <Tag variant="cool" size="sm">
          {sources.length}
        </Tag>
      </div>
      {isLoading ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading SBOM evidence history...
        </p>
      ) : isError ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {readErrorMessage(error)}
        </p>
      ) : sources.length === 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          No SBOM evidence has been uploaded for this release.
        </p>
      ) : (
        <div className="mt-3 grid min-w-0 max-w-full gap-2" role="list">
          {sources.map((item) => {
            const selected = item.source.id === selectedSourceId;
            return (
              <button
                key={item.source.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(item.source.id)}
                className={cn(
                  "w-full min-w-0 max-w-full rounded-xl border p-3 text-left outline-none",
                  "focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  selected
                    ? "border-active-500 bg-canvas"
                    : "border-border bg-canvas hover:bg-surface",
                )}
              >
                <span className="block truncate text-caption-1-semibold text-fg">
                  {item.source.fileName}
                </span>
                <span className="mt-1 flex min-w-0 max-w-full flex-wrap gap-2">
                  <Tag
                    variant="dot"
                    size="sm"
                    tone={tagToneForValidation(item.validation.status)}
                  >
                    {validationStatusLabel(item.validation.status)}
                  </Tag>
                  <Tag
                    variant="dot"
                    size="sm"
                    tone={tagToneForSource(item.source.status)}
                  >
                    {sourceStatusLabel(item.source.status)}
                  </Tag>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReportPanel({
  source,
  report,
  validationStatus,
  selectedSummary,
  reportLoading,
  reportError,
  error,
  diagnosticCounts,
  totalDiagnostics,
  diagnosticFilter,
  visibleDiagnostics,
  omittedDiagnosticCount,
  canUpload,
  downloading,
  onFilter,
  onDownload,
  onCorrect,
  correctionSourceId,
}: Readonly<{
  source: SbomSource | null;
  report: SbomValidationReport | null;
  validationStatus: SbomValidationStatus;
  selectedSummary: SbomSourceHistoryItem["validation"] | null;
  reportLoading: boolean;
  reportError: boolean;
  error: unknown;
  diagnosticCounts: { error: number; warning: number };
  totalDiagnostics: number;
  diagnosticFilter: DiagnosticFilter;
  visibleDiagnostics: readonly SbomValidationDiagnostic[];
  omittedDiagnosticCount: number;
  canUpload: boolean;
  downloading: boolean;
  onFilter: (filter: DiagnosticFilter) => void;
  onDownload: () => void;
  onCorrect?: () => void;
  correctionSourceId: string | null;
}>) {
  if (!source) {
    return (
      <div className="min-w-0 max-w-full rounded-xl border border-border bg-surface-subtle p-4">
        <p className="text-subhead-semibold text-fg">Validation report</p>
        <p className="mt-2 text-caption-1-regular text-fg-muted">
          Upload evidence to see detected type, version, hash, status, and
          diagnostics.
        </p>
      </div>
    );
  }

  const canCorrect =
    canUpload &&
    (validationStatus === "invalid" ||
      validationStatus === "valid_with_warnings");
  const completedAt = report?.completedAt ?? selectedSummary?.completedAt;
  const hasReportDiagnostics = report !== null;
  const shouldExplainUnavailableDiagnostics =
    !hasReportDiagnostics &&
    (reportLoading ||
      reportError ||
      validationStatus === "pending" ||
      totalDiagnostics > 0);

  return (
    <div className="min-w-0 max-w-full rounded-xl border border-border bg-surface-subtle p-4">
      <div className="flex min-w-0 max-w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-subhead-semibold text-fg">Validation report</p>
          <p className="mt-1 truncate text-caption-1-regular text-fg-muted">
            {source.fileName}
          </p>
        </div>
        <Tag
          variant="dot"
          tone={tagToneForValidation(validationStatus)}
          size="sm"
        >
          {validationStatusLabel(validationStatus)}
        </Tag>
      </div>
      {reportLoading ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading validation report...
        </p>
      ) : reportError ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {readErrorMessage(error)}
        </p>
      ) : validationStatus === "pending" ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          Validation is processing. Results will appear when parsing completes.
        </p>
      ) : null}
      <dl className="mt-4 grid min-w-0 max-w-full gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReportFact label="Detected" value={detectedSummary(report, source)} />
        <ReportFact
          label="Serialization"
          value={titleCase(report?.detected?.serialization ?? "pending")}
        />
        <ReportFact label="Immutable hash" value={source.sha256.slice(0, 12)} />
        <ReportFact
          label="Completed"
          value={
            completedAt ? new Date(completedAt).toLocaleString() : "Pending"
          }
        />
      </dl>
      <div className="mt-4 flex min-w-0 max-w-full flex-wrap items-center gap-2">
        {(["all", "error", "warning"] as const).map((filter) => {
          const count =
            filter === "all" ? totalDiagnostics : diagnosticCounts[filter];
          return (
            <Button
              key={filter}
              type="button"
              size="sm"
              variant={diagnosticFilter === filter ? "fill" : "outline"}
              tone={diagnosticFilter === filter ? "subPrimary" : "grey"}
              aria-pressed={diagnosticFilter === filter}
              onClick={() => onFilter(filter)}
            >
              {diagnosticFilterLabel(filter, count)}
            </Button>
          );
        })}
      </div>
      {hasReportDiagnostics && omittedDiagnosticCount > 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          Showing the first {visibleDiagnostics.length} diagnostics;{" "}
          {omittedDiagnosticCount} additional entries are omitted from this
          bounded report.
        </p>
      ) : null}
      {hasReportDiagnostics ? (
        <DiagnosticsTable diagnostics={visibleDiagnostics} />
      ) : shouldExplainUnavailableDiagnostics ? (
        <DiagnosticsUnavailableState degraded={reportError} />
      ) : (
        <DiagnosticsTable diagnostics={visibleDiagnostics} />
      )}
      <div className="mt-4 flex min-w-0 max-w-full flex-wrap gap-2">
        {source.status === "verified" ? (
          <Button
            type="button"
            variant="outline"
            tone="grey"
            className="w-full sm:w-auto"
            startIcon={<Download aria-hidden="true" />}
            loading={downloading}
            loadingLabel="Preparing download"
            onClick={onDownload}
          >
            Download original
          </Button>
        ) : null}
        {canCorrect && onCorrect ? (
          <Button
            type="button"
            variant="outline"
            tone="primary"
            className="w-full sm:w-auto"
            startIcon={<UploadCloud aria-hidden="true" />}
            onClick={onCorrect}
            aria-pressed={correctionSourceId === source.id}
          >
            Upload corrected version
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DiagnosticsUnavailableState({
  degraded,
}: Readonly<{ degraded: boolean }>) {
  if (degraded) {
    return (
      <p
        role="status"
        className="mt-4 min-w-0 max-w-full rounded-xl border border-border bg-canvas p-3 text-caption-1-regular text-fg-muted"
      >
        Diagnostic details are unavailable. Counts are available from the latest
        source summary; retry the report view to load rows.
      </p>
    );
  }

  return (
    <p
      role="status"
      className="mt-4 min-w-0 max-w-full rounded-xl border border-border bg-canvas p-3 text-caption-1-regular text-fg-muted"
    >
      Diagnostic details are still processing. Counts are available from the
      source summary and rows will appear when validation finishes.
    </p>
  );
}

function ReportFact({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0 max-w-full">
      <dt className="text-caption-2-uppercase text-fg-subtle">{label}</dt>
      <dd className="mt-1 truncate break-words font-mono text-caption-1-regular text-fg">
        {value}
      </dd>
    </div>
  );
}

function DiagnosticsTable({
  diagnostics,
}: Readonly<{ diagnostics: readonly SbomValidationDiagnostic[] }>) {
  if (diagnostics.length === 0) {
    return (
      <p className="mt-4 text-caption-1-regular text-fg-muted">
        No diagnostics match this filter.
      </p>
    );
  }

  return (
    <div className="mt-4 max-w-full overflow-x-auto rounded-xl border border-border bg-canvas">
      <table
        aria-label="SBOM diagnostics"
        className="min-w-[44rem] table-fixed border-collapse"
      >
        <thead className="bg-surface">
          <tr>
            <th className="w-24 px-3 py-2 text-left text-caption-2-uppercase text-fg-subtle">
              Severity
            </th>
            <th className="w-40 px-3 py-2 text-left text-caption-2-uppercase text-fg-subtle">
              Code
            </th>
            <th className="w-48 px-3 py-2 text-left text-caption-2-uppercase text-fg-subtle">
              Location
            </th>
            <th className="px-3 py-2 text-left text-caption-2-uppercase text-fg-subtle">
              Message
            </th>
            <th className="px-3 py-2 text-left text-caption-2-uppercase text-fg-subtle">
              Remediation
            </th>
          </tr>
        </thead>
        <tbody>
          {diagnostics.map((diagnostic) => (
            <tr
              key={`${diagnostic.severity}-${diagnostic.code}-${diagnostic.location}`}
              className="border-t border-border"
            >
              <td className="px-3 py-2 align-top">
                <Tag
                  variant="dot"
                  size="sm"
                  tone={
                    diagnostic.severity === "error"
                      ? "red"
                      : diagnostic.severity === "warning"
                        ? "orange"
                        : "blue"
                  }
                >
                  {titleCase(diagnostic.severity)}
                </Tag>
              </td>
              <td className="break-words px-3 py-2 align-top font-mono text-caption-1-regular text-fg">
                {diagnostic.code}
              </td>
              <td className="break-words px-3 py-2 align-top font-mono text-caption-1-regular text-fg-muted">
                {diagnostic.location}
              </td>
              <td className="break-words px-3 py-2 align-top text-caption-1-regular text-fg">
                {diagnostic.message}
              </td>
              <td className="break-words px-3 py-2 align-top text-caption-1-regular text-fg-muted">
                {diagnostic.remediation}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
