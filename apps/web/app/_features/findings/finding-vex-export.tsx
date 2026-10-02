"use client";

import type {
  VulnerabilityVexExport,
  VulnerabilityVexPublicationJob,
  VulnerabilityVexPublicationTarget,
} from "@repo/contracts/vulnerabilities";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Input } from "@repo/ui/input";
import { Tag, type TagProps } from "@repo/ui/tag";
import { useEffect, useMemo, useState } from "react";

import { useHasPermission } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateVulnerabilityVexExportMutation,
  useEnqueueVulnerabilityVexPublicationMutation,
  useRetryVulnerabilityVexPublicationMutation,
  useUpdateVulnerabilityVexPublicationTargetMutation,
  useVulnerabilityVexExportPreviewQuery,
  useVulnerabilityVexExportDownloadMutation,
  useVulnerabilityVexExportsQuery,
  useVulnerabilityVexPublicationTargetsQuery,
  useVulnerabilityVexPublicationsQuery,
  useWithdrawVulnerabilityVexPublicationMutation,
} from "./triage.queries";

function uuid(): string {
  return crypto.randomUUID();
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function exportRequestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to export or publish VEX data.";
  if (error instanceof ApiClientError && error.status === 409)
    return "The export scope changed. Review the current approved revisions and try again.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Your export choices remain available; reconnect and try again.";
  return "This VEX operation could not be completed. Try again.";
}

function publicationTone(
  state: VulnerabilityVexPublicationJob["state"],
): TagProps["tone"] {
  if (state === "published") return "green";
  if (state === "dead_letter") return "red";
  if (state === "retrying" || state === "leased") return "orange";
  return "purple";
}

function publicationStateLabel(
  state: VulnerabilityVexPublicationJob["state"],
): string {
  if (state === "dead_letter") return "Delivery failed";
  if (state === "leased") return "Publishing";
  return titleCase(state);
}

function exportFormatLabel(format: VulnerabilityVexExport["format"]): string {
  return format === "openvex" ? "OpenVEX 0.2.0" : "CycloneDX VEX 1.6";
}

export function FindingVexExport({
  productId,
  productName,
  releaseId,
  releaseName,
}: Readonly<{
  productId: string;
  productName: string;
  releaseId: string;
  releaseName: string;
}>) {
  const canExport = useHasPermission("can_export_findings");
  const canManagePublication = useHasPermission(
    "can_manage_finding_publication",
  );
  const scope = useMemo(
    () => ({ productId, releaseId }),
    [productId, releaseId],
  );
  const preview = useVulnerabilityVexExportPreviewQuery(scope, canExport);
  const exports = useVulnerabilityVexExportsQuery(scope, canExport);
  const create = useCreateVulnerabilityVexExportMutation();
  const [selectedFormat, setSelectedFormat] =
    useState<VulnerabilityVexExport["format"]>("openvex");
  const [message, setMessage] = useState<string | null>(null);

  const selectedAvailability = preview.data?.formatAvailability.find(
    (availability) => availability.format === selectedFormat,
  );

  async function createExport() {
    if (!preview.data || !selectedAvailability?.supported) return;
    setMessage(null);
    try {
      await create.mutateAsync({
        ...scope,
        format: selectedFormat,
        expectedScopeVersion: preview.data.scopeVersion,
        expectedScopeDigest: preview.data.scopeDigest,
        idempotencyKey: uuid(),
      });
    } catch (error) {
      setMessage(exportRequestMessage(error));
    }
  }

  return (
    <section className="mt-6" aria-labelledby="vex-export-heading">
      <div className="rounded-xl border border-border bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              id="vex-export-heading"
              className="text-subhead-semibold text-fg"
            >
              Validated VEX export
            </h3>
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              Exports only current approved VEX revisions for this exact product
              and release. Internal notes and evidence are never included.
            </p>
          </div>
          <Tag variant="dot" tone="purple">
            {productName} · {releaseName}
          </Tag>
        </div>

        {!canExport ? (
          <p className="mt-4 text-caption-1-regular text-fg-muted">
            You do not have permission to export findings for this release.
          </p>
        ) : null}
        {canExport && preview.isLoading ? (
          <p
            role="status"
            className="mt-4 text-caption-1-regular text-fg-muted"
          >
            Checking eligible approved revisions…
          </p>
        ) : null}
        {canExport && preview.isError ? (
          <InlineError
            message="The VEX export preview is unavailable. No export has been created."
            onRetry={() => void preview.refetch()}
          />
        ) : null}
        {canExport && preview.data ? (
          <>
            <p className="mt-4 text-caption-1-regular text-fg">
              {preview.data.eligibleAssessmentRevisions.length} eligible
              approved revision
              {preview.data.eligibleAssessmentRevisions.length === 1 ? "" : "s"}
              {" · "}scope version {preview.data.scopeVersion}
            </p>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
                Export format
                <select
                  value={selectedFormat}
                  onChange={(event) => {
                    setSelectedFormat(
                      event.target.value as VulnerabilityVexExport["format"],
                    );
                    setMessage(null);
                  }}
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <option value="openvex">OpenVEX 0.2.0</option>
                  <option value="cyclonedx-vex">CycloneDX VEX 1.6</option>
                </select>
              </label>
              <Button
                loading={create.isPending}
                disabled={!selectedAvailability?.supported || create.isPending}
                onClick={() => void createExport()}
              >
                Create validated export
              </Button>
            </div>
            {selectedAvailability && !selectedAvailability.supported ? (
              <div
                role="alert"
                className="mt-3 text-caption-1-regular text-danger"
              >
                {exportFormatLabel(selectedFormat)} cannot represent this scope
                without changing affectedness. Choose OpenVEX or resolve the
                listed assessment mappings.
                <ul
                  className="mt-2 list-disc pl-5"
                  aria-label="VEX mapping issues"
                >
                  {selectedAvailability.mappingIssues
                    .slice(0, 5)
                    .map((issue) => (
                      <li key={`${issue.findingId}-${issue.assessmentId}`}>
                        {issue.message}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            {message ? (
              <p
                role="alert"
                className="mt-3 text-caption-1-regular text-danger"
              >
                {message}
              </p>
            ) : null}
          </>
        ) : null}

        <ExportList
          exports={exports.data?.exports}
          loading={exports.isLoading}
          error={exports.isError}
          onRetry={() => void exports.refetch()}
          canManagePublication={canManagePublication}
        />
      </div>
    </section>
  );
}

function InlineError({
  message,
  onRetry,
}: Readonly<{ message: string; onRetry: () => void }>) {
  return (
    <div role="alert" className="mt-4 text-caption-1-regular text-danger">
      {message}
      <Button
        className="ml-2"
        size="sm"
        variant="gap"
        tone="grey"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

function ExportList({
  exports,
  loading,
  error,
  onRetry,
  canManagePublication,
}: Readonly<{
  exports: readonly VulnerabilityVexExport[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  canManagePublication: boolean;
}>) {
  const [selectedExportId, setSelectedExportId] = useState<string | null>(null);
  const download = useVulnerabilityVexExportDownloadMutation();
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  useEffect(() => {
    if (exports?.some((item) => item.id === selectedExportId)) return;
    setSelectedExportId(exports?.[0]?.id ?? null);
  }, [exports, selectedExportId]);
  const selectedExport =
    exports?.find((item) => item.id === selectedExportId) ?? null;

  async function downloadSelectedExport() {
    if (selectedExport === null) return;
    const exportId = selectedExport.id;
    if (exportId === null) return;
    setDownloadMessage(null);
    try {
      const handoff = await download.mutateAsync(exportId);
      window.location.assign(handoff.downloadUrl);
    } catch (error) {
      setDownloadMessage(exportRequestMessage(error));
    }
  }

  return (
    <section
      className="mt-5 border-t border-border pt-4"
      aria-labelledby="vex-export-history-heading"
    >
      <h4
        id="vex-export-history-heading"
        className="text-subhead-semibold text-fg"
      >
        Export snapshots
      </h4>
      {loading ? (
        <p role="status" className="mt-2 text-caption-1-regular text-fg-muted">
          Loading export snapshots…
        </p>
      ) : null}
      {error ? (
        <InlineError
          message="Export history is unavailable."
          onRetry={onRetry}
        />
      ) : null}
      {exports?.length === 0 ? (
        <p className="mt-2 text-caption-1-regular text-fg-muted">
          No validated VEX export has been created for this release.
        </p>
      ) : null}
      {exports && exports.length > 0 ? (
        <div className="mt-3 grid gap-3">
          <ul className="grid gap-2" aria-label="VEX export snapshots">
            {exports.map((snapshot) => (
              <li key={snapshot.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-lg border border-border p-3 text-left text-caption-1-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus",
                    selectedExportId === snapshot.id && "bg-surface-muted",
                  )}
                  aria-pressed={selectedExportId === snapshot.id}
                  onClick={() => setSelectedExportId(snapshot.id)}
                >
                  <span className="font-medium">
                    {exportFormatLabel(snapshot.format)}
                  </span>
                  <span className="block text-fg-muted">
                    {formatInstant(snapshot.createdAt)} · SHA-256{" "}
                    {snapshot.contentSha256}
                  </span>
                  <span className="block text-fg-muted">
                    {snapshot.assessmentRevisionReferences.length} approved
                    revisions · {snapshot.byteSize} bytes
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selectedExport ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  loading={download.isPending}
                  disabled={download.isPending}
                  onClick={() => void downloadSelectedExport()}
                >
                  Download export
                </Button>
                <span className="text-caption-1-regular text-fg-muted">
                  Download verifies SHA-256 {selectedExport.contentSha256}.
                </span>
              </div>
              {downloadMessage ? (
                <p role="alert" className="text-caption-1-regular text-danger">
                  {downloadMessage}
                </p>
              ) : null}
              <PublicationControls
                exportSnapshot={selectedExport}
                canManagePublication={canManagePublication}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PublicationControls({
  exportSnapshot,
  canManagePublication,
}: Readonly<{
  exportSnapshot: VulnerabilityVexExport;
  canManagePublication: boolean;
}>) {
  const targets =
    useVulnerabilityVexPublicationTargetsQuery(canManagePublication);
  const publications = useVulnerabilityVexPublicationsQuery(
    exportSnapshot.id,
    canManagePublication,
  );
  const updateTarget = useUpdateVulnerabilityVexPublicationTargetMutation();
  const enqueue = useEnqueueVulnerabilityVexPublicationMutation();
  const retry = useRetryVulnerabilityVexPublicationMutation();
  const withdraw = useWithdrawVulnerabilityVexPublicationMutation();
  const [targetKey, setTargetKey] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const selectedTarget =
    targets.data?.targets.find((target) => target.targetKey === targetKey) ??
    null;

  useEffect(() => {
    if (targets.data?.targets.some((target) => target.targetKey === targetKey))
      return;
    setTargetKey(targets.data?.targets[0]?.targetKey ?? "");
  }, [targetKey, targets.data?.targets]);
  useEffect(() => {
    setConfirmed(false);
    setWithdrawalReason("");
    setMessage(null);
  }, [exportSnapshot.id]);

  if (!canManagePublication) {
    return (
      <p className="text-caption-1-regular text-fg-muted">
        Publication requires organization publication permission.
      </p>
    );
  }

  async function publish() {
    if (!selectedTarget?.id || !confirmed || !selectedTarget.enabled) return;
    const exportId = exportSnapshot.id;
    if (exportId === null) return;
    setMessage(null);
    try {
      await enqueue.mutateAsync({
        exportId,
        input: {
          targetId: selectedTarget.id,
          expectedTargetVersion: selectedTarget.version,
          expectedExportContentSha256: exportSnapshot.contentSha256,
          confirmTarget: true,
          idempotencyKey: uuid(),
        },
      });
      setConfirmed(false);
    } catch (error) {
      setMessage(exportRequestMessage(error));
    }
  }

  async function toggleTarget(target: VulnerabilityVexPublicationTarget) {
    setMessage(null);
    try {
      await updateTarget.mutateAsync({
        targetKey: target.targetKey,
        enabled: !target.enabled,
        expectedVersion: target.version,
        idempotencyKey: uuid(),
      });
    } catch (error) {
      setMessage(exportRequestMessage(error));
    }
  }

  async function retryPublication(publication: VulnerabilityVexPublicationJob) {
    const exportId = exportSnapshot.id;
    if (exportId === null) return;
    setMessage(null);
    try {
      await retry.mutateAsync({
        exportId,
        publicationId: publication.id,
        input: { expectedVersion: publication.version, idempotencyKey: uuid() },
      });
    } catch (error) {
      setMessage(exportRequestMessage(error));
    }
  }

  async function withdrawPublication(
    publication: VulnerabilityVexPublicationJob,
  ) {
    if (withdrawalReason.trim() === "") {
      setMessage(
        "A withdrawal reason is required to preserve publication evidence.",
      );
      return;
    }
    const exportId = exportSnapshot.id;
    if (exportId === null) return;
    setMessage(null);
    try {
      await withdraw.mutateAsync({
        exportId,
        publicationId: publication.id,
        input: {
          expectedVersion: publication.version,
          withdrawalReason: withdrawalReason.trim(),
          idempotencyKey: uuid(),
        },
      });
      setWithdrawalReason("");
    } catch (error) {
      setMessage(exportRequestMessage(error));
    }
  }

  return (
    <section
      className="rounded-lg border border-border bg-surface-subtle p-3"
      aria-labelledby="vex-publication-heading"
    >
      <h5
        id="vex-publication-heading"
        className="text-subhead-semibold text-fg"
      >
        Controlled publication
      </h5>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        Publication is separate from export. It does not change regulatory
        deadlines, reports, or the immutable local snapshot.
      </p>
      {targets.isLoading ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading configured targets…
        </p>
      ) : null}
      {targets.isError ? (
        <InlineError
          message="Publication targets are unavailable."
          onRetry={() => void targets.refetch()}
        />
      ) : null}
      {targets.data ? (
        <>
          <label className="mt-3 flex flex-col gap-1 text-caption-1-regular text-fg">
            Configured publication target
            <select
              value={targetKey}
              onChange={(event) => {
                setTargetKey(event.target.value);
                setConfirmed(false);
              }}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:ring-2 focus-visible:ring-focus"
            >
              {targets.data.targets.map((target) => (
                <option key={target.targetKey} value={target.targetKey}>
                  {target.label} · {titleCase(target.kind)} ·{" "}
                  {target.enabled ? "Enabled" : "Disabled"}
                </option>
              ))}
            </select>
          </label>
          {selectedTarget ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Tag
                variant="dot"
                tone={selectedTarget.enabled ? "green" : "purple"}
              >
                {selectedTarget.enabled ? "Target enabled" : "Target disabled"}
              </Tag>
              <Button
                size="sm"
                variant="outline"
                tone="grey"
                loading={updateTarget.isPending}
                onClick={() => void toggleTarget(selectedTarget)}
              >
                {selectedTarget.enabled ? "Disable target" : "Enable target"}
              </Button>
            </div>
          ) : null}
          <label className="mt-3 flex items-start gap-2 text-caption-1-regular text-fg">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1 size-4 rounded border-border focus-visible:ring-2 focus-visible:ring-focus"
            />
            <span>
              I confirm publication of SHA-256 {exportSnapshot.contentSha256} to
              this configured target.
            </span>
          </label>
          <Button
            className="mt-3"
            loading={enqueue.isPending}
            disabled={
              !selectedTarget?.enabled || !confirmed || enqueue.isPending
            }
            onClick={() => void publish()}
          >
            Queue publication
          </Button>
        </>
      ) : null}
      {message ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
      {publications.isLoading ? (
        <p role="status" className="mt-4 text-caption-1-regular text-fg-muted">
          Loading publication history…
        </p>
      ) : null}
      {publications.isError ? (
        <InlineError
          message="Publication history is unavailable."
          onRetry={() => void publications.refetch()}
        />
      ) : null}
      {publications.data?.publications.length === 0 ? (
        <p className="mt-4 text-caption-1-regular text-fg-muted">
          This export has not been published.
        </p>
      ) : null}
      {publications.data && publications.data.publications.length > 0 ? (
        <ul className="mt-4 grid gap-2" aria-label="VEX publication history">
          {publications.data.publications.map((publication) => (
            <li
              key={publication.id}
              className="rounded-lg border border-border bg-canvas p-3 text-caption-1-regular text-fg"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Tag variant="dot" tone={publicationTone(publication.state)}>
                  {publicationStateLabel(publication.state)}
                </Tag>
                <span className="text-fg-muted">
                  Attempts {publication.attempts} ·{" "}
                  {formatInstant(publication.updatedAt)}
                </span>
              </div>
              {publication.lastErrorMessage ? (
                <p role="alert" className="mt-2 text-danger">
                  {publication.lastErrorMessage}
                </p>
              ) : null}
              {publication.state === "dead_letter" ? (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  tone="grey"
                  loading={retry.isPending}
                  onClick={() => void retryPublication(publication)}
                >
                  Retry publication
                </Button>
              ) : null}
              {["published", "replaced"].includes(publication.state) ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    value={withdrawalReason}
                    onChange={(event) =>
                      setWithdrawalReason(event.target.value)
                    }
                    aria-label="Withdrawal reason"
                    placeholder="Withdrawal reason"
                    maxLength={1000}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    tone="grey"
                    loading={withdraw.isPending}
                    onClick={() => void withdrawPublication(publication)}
                  >
                    Withdraw publication
                  </Button>
                </div>
              ) : null}
              {publication.state === "withdrawn" ? (
                <p className="mt-2 text-fg-muted">
                  Withdrawn{" "}
                  {publication.withdrawnAt
                    ? formatInstant(publication.withdrawnAt)
                    : ""}
                  {publication.withdrawnReason
                    ? ` · ${publication.withdrawnReason}`
                    : ""}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
