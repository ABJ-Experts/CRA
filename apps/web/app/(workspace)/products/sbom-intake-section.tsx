"use client";

import {
  SBOM_MAX_UPLOAD_BYTES,
  sbomMediaTypeSchema,
  type SbomJob,
  type SbomSource,
} from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { sbomsApi } from "../../_features/sboms/sboms.api";
import { useSbomJobQuery } from "../../_features/sboms/sboms.queries";

type ReleaseOption = Readonly<{ id: string; label: string; version: string }>;
type UploadPhase =
  "idle" | "hashing" | "reserving" | "uploading" | "completing";

const ACCEPTED_SBOM_TYPES = Object.freeze(sbomMediaTypeSchema.options);
const ACCEPT_ATTRIBUTE = ACCEPTED_SBOM_TYPES.join(",");

function requestId(): string {
  return crypto.randomUUID();
}

async function sha256(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot securely calculate a file checksum.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function statusLabel(status: SbomJob["status"]): string {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: SbomJob["status"]): string {
  if (status === "completed") return "border-success bg-surface text-fg";
  if (status === "failed" || status === "dead_letter") {
    return "border-danger bg-surface text-fg";
  }
  return "border-info bg-surface text-fg";
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

function validateFile(file: File): string | null {
  if (file.size < 1) return "Choose a non-empty SBOM file.";
  if (file.size > SBOM_MAX_UPLOAD_BYTES)
    return "SBOM files must be 100 MiB or smaller.";
  if (!sbomMediaTypeSchema.safeParse(file.type).success) {
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
  const jobQuery = useSbomJobQuery(job?.id ?? null, enabled && canView);

  useEffect(() => {
    if (releases.some((release) => release.id === releaseId)) return;
    setReleaseId(releases[0]?.id ?? "");
  }, [releaseId, releases]);

  const currentJob = jobQuery.data?.job ?? job;
  const busy = phase !== "idle";
  const selectedRelease = releases.find((release) => release.id === releaseId);
  const uploadStatus = useMemo(() => {
    if (phase === "hashing") return "Calculating SHA-256…";
    if (phase === "reserving") return "Reserving immutable evidence…";
    if (phase === "uploading") {
      return progress === null
        ? "Uploading to secure storage…"
        : `Uploading to secure storage… ${Math.round(progress * 100)}%`;
    }
    if (phase === "completing") return "Verifying original evidence…";
    return null;
  }, [phase, progress]);

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
    setMessage("Original evidence is verified and queued for processing.");
  }

  async function upload() {
    if (!file || !selectedRelease) return;
    const invalid = validateFile(file);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    const mediaType = sbomMediaTypeSchema.parse(file.type);

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
      });
      setSource(initialized.source);
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
    if (!source) return;
    setDownloading(true);
    setMessage(null);
    try {
      triggerDownload(
        await sbomsApi
          .downloadOriginal(source.id)
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

  return (
    <section
      aria-labelledby="sbom-evidence-heading"
      className="rounded-xl border border-border bg-canvas p-4 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id="sbom-evidence-heading"
            className="text-title-semibold text-fg"
          >
            SBOM evidence
          </h2>
          <p className="mt-1 max-w-3xl text-subhead-regular text-fg-muted">
            Preserve the exact original and queue it for secure intake. Parsing
            and component analysis begin in later workflows.
          </p>
        </div>
        {currentJob ? (
          <span
            className={`w-fit rounded-full border px-2.5 py-1 text-caption-1-semibold ${statusClass(currentJob.status)}`}
          >
            {statusLabel(currentJob.status)}
          </span>
        ) : null}
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
        <div className="mt-5 grid gap-4">
          <label className="flex max-w-md flex-col gap-2 text-caption-1-regular text-fg">
            Release
            <select
              id="sbom-release"
              name="sbom-release"
              aria-label="Release"
              value={releaseId}
              onChange={(event) => setReleaseId(event.target.value)}
              disabled={busy}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {releases.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.label} · {release.version}
                </option>
              ))}
            </select>
          </label>
          {canUpload ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="flex min-w-0 flex-col gap-2 text-caption-1-regular text-fg">
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
                  className="min-h-10 rounded-xl border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-2 file:py-1 file:text-caption-1-semibold file:text-fg"
                />
              </label>
              <Button
                type="button"
                disabled={!file || busy}
                loading={busy}
                loadingLabel={uploadStatus ?? "Uploading SBOM"}
                onClick={() => void upload()}
              >
                Upload SBOM
              </Button>
            </div>
          ) : (
            <p className="text-caption-1-regular text-fg-muted">
              You can view SBOM evidence, but do not have permission to upload
              it.
            </p>
          )}
          <p className="text-caption-1-regular text-fg-muted">
            JSON, XML, and approved SBOM media types only. Maximum size: 100
            MiB.
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
              disabled={busy}
              loading={phase === "completing"}
              loadingLabel="Verifying original evidence"
              onClick={() => void completeExistingUpload()}
            >
              Complete uploaded file
            </Button>
          ) : null}
          {source && currentJob?.status === "completed" ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              className="w-fit"
              loading={downloading}
              loadingLabel="Preparing download"
              onClick={() => void downloadOriginal()}
            >
              Download original
            </Button>
          ) : null}
          {currentJob ? (
            <div
              aria-live="polite"
              className="rounded-xl border border-border bg-surface-subtle p-4"
            >
              <p className="text-subhead-semibold text-fg">
                {currentJob.progress.message}
              </p>
              <p className="mt-1 text-caption-1-regular text-fg-muted">
                {currentJob.progress.percent}% complete · attempt{" "}
                {currentJob.attempts} of {currentJob.maxAttempts}
              </p>
              {currentJob.error ? (
                <p
                  role="alert"
                  className="mt-2 text-caption-1-regular text-danger"
                >
                  {currentJob.error.message}
                </p>
              ) : null}
              {canReplay && currentJob.status === "dead_letter" ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  className="mt-3"
                  loading={replaying}
                  loadingLabel="Replaying job"
                  onClick={() => void replay()}
                >
                  Replay intake job
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
