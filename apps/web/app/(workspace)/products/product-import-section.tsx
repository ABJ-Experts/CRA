"use client";

import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import type { ProductImport } from "@repo/contracts/products";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  useCancelProductImportMutation,
  useCommitProductImportMutation,
  useProductImportQuery,
  useProductImportReportMutation,
  useProductImportRowsQuery,
  useProductImportTemplateQuery,
  useProductImportsQuery,
  useUploadProductImportMutation,
} from "../../_features/products/products.queries";
import { productKeys } from "../../_features/products/products.keys";
import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

const COPY = Object.freeze({
  title: "Import products and releases",
  description:
    "Upload a versioned CSV for validation. Product and release records are not changed until you confirm a successful dry run.",
  chooseFile: "Import CSV file",
  validate: "Validate CSV",
  validating: "Validating CSV",
  template: "Download template",
  report: "Download result report",
  commit: "Commit validated import",
  committing: "Committing import",
  cancel: "Cancel import",
  canceled: "Import canceled.",
  noFile: "Choose a CSV file before validation.",
  uploadFailed:
    "The CSV could not be validated. Review the file and try again.",
  templateFailed: "The template could not be downloaded.",
  commitFailed:
    "The validated import could not be committed. Refresh its status before retrying.",
  reportFailed: "The result report could not be downloaded.",
  rowIssues: "Row validation results",
  noIssues: "No row validation issues were found.",
  canceling: "Canceling import",
  loadingTemplate: "Preparing template",
  loadingReport: "Preparing result report",
  loadingRows: "Loading row results…",
  rowsFailed: "Row results could not be loaded.",
  retry: "Try again",
  importAttention: "The import requires attention before it can be committed.",
  recentFailed: "Recent imports could not be loaded.",
  recent: "Recent imports",
  recentAria: "Recent imports",
  review: "Review import",
  progress: "{processed} of {total} rows processed",
  expires: "Expires {timestamp}",
  row: "Row",
  action: "Action",
  result: "Result",
  record: "Record",
  issues: "Issues",
  previousPage: "Previous result page",
  nextPage: "Next result page",
  page: "Page",
  pageProgress: "{page} of {pageCount}",
  emptyIssue: "—",
  issue: "{field}: {message}",
  issueSeparator: "; ",
  recordWithRelease: "{productCode} · {releaseVersion}",
  recordUnavailable: "—",
  countLabels: Object.freeze({
    create: "create",
    update: "update",
    unchanged: "unchanged",
    skipped: "skipped",
    failed: "failed",
    warnings: "warnings",
  }),
  statusUnavailable: "Import status unavailable",
  stale: "This dry run is stale. Validate the CSV again before committing.",
  expired: "This dry run has expired. Upload and validate the CSV again.",
  network:
    "We could not reach the registry. Your import has not been discarded.",
  cancelFailed: "The import could not be canceled.",
  forbidden: "You do not have permission to view product imports.",
  readOnly:
    "You can review imports, but you do not have permission to change them.",
  statuses: Object.freeze({
    queued: "Queued for validation",
    parsing: "Parsing CSV",
    validating: "Validating CSV",
    dry_run_completed: "Dry run completed",
    dry_run_failed: "Dry run completed with errors",
    committing: "Commit in progress",
    retrying: "Retrying import",
    dead_letter: "Import requires recovery",
    stale_conflict: "Dry run is stale",
    completed: "Import completed",
    canceled: "Import canceled",
    expired: "Dry run expired",
  }),
} as const);

function formatMessage(
  template: string,
  values: Readonly<Record<string, number | string>>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 409) {
    return COPY.stale;
  }
  if (error instanceof ApiClientError && error.status === 410) {
    return COPY.expired;
  }
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network") {
    return COPY.network;
  }
  return fallback;
}

function statusLabel(status: string): string {
  return (
    COPY.statuses[status as keyof typeof COPY.statuses] ??
    COPY.statusUnavailable
  );
}

function statusTone(status: string): "green" | "red" | "orange" | "indigo" {
  if (status === "completed") return "green";
  if (status === "dry_run_failed" || status === "dead_letter") return "red";
  if (
    status === "committing" ||
    status === "retrying" ||
    status === "expired" ||
    status === "stale_conflict"
  )
    return "orange";
  return "indigo";
}

function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function openDownload(downloadUrl: string): void {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

function Summary({ counts }: { counts: Readonly<Record<string, number>> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-caption-1-regular text-fg sm:grid-cols-6">
      {(
        [
          "create",
          "update",
          "unchanged",
          "skipped",
          "failed",
          "warnings",
        ] as const
      ).map((key) => (
        <div key={key} className="flex items-baseline gap-1">
          <dd className="font-medium tabular-nums">{counts[key] ?? 0}</dd>
          <dt className="capitalize text-fg-muted">{COPY.countLabels[key]}</dt>
        </div>
      ))}
    </dl>
  );
}

function canonicalRecord(
  row: Readonly<{
    productInternalCode: string | null;
    releaseVersion: string | null;
  }>,
): string {
  if (row.productInternalCode === null) return COPY.recordUnavailable;
  if (row.releaseVersion === null) return row.productInternalCode;
  return formatMessage(COPY.recordWithRelease, {
    productCode: row.productInternalCode,
    releaseVersion: row.releaseVersion,
  });
}

export function ProductImportSection({
  canView,
  canCreate,
  canEdit,
  canExport,
}: {
  readonly canView: boolean;
  readonly canCreate: boolean;
  readonly canEdit: boolean;
  readonly canExport: boolean;
}) {
  const queryClient = useQueryClient();
  const canWrite = canCreate && canEdit;
  const [file, setFile] = useState<File | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProductImport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const template = useProductImportTemplateQuery(false);
  const history = useProductImportsQuery({ page: 1, pageSize: 5 }, canView);
  const upload = useUploadProductImportMutation();
  const imported = useProductImportQuery(
    importId ?? "",
    importId !== null && canView,
  );
  const rows = useProductImportRowsQuery(
    importId ?? "",
    { page, pageSize: 25 },
    importId !== null && canView,
  );
  const commit = useCommitProductImportMutation(importId ?? "");
  const cancel = useCancelProductImportMutation(importId ?? "");
  const report = useProductImportReportMutation(importId ?? "");
  const currentImport = imported.data?.import ?? snapshot;
  const displayedImport = currentImport ?? null;
  const hasBlockingErrors = (displayedImport?.counts.failed ?? 0) > 0;
  const canCommit =
    canWrite &&
    displayedImport?.status === "dry_run_completed" &&
    !hasBlockingErrors;

  useEffect(() => {
    if (displayedImport?.status !== "completed") return;

    // This prefix covers the active import row page as well as import history.
    void queryClient.invalidateQueries({ queryKey: productKeys.imports });
    void queryClient.invalidateQueries({ queryKey: productKeys.lists });
  }, [displayedImport?.status, queryClient]);

  async function downloadTemplate() {
    setMessage(null);
    try {
      const response = await template.refetch();
      if (response.data) {
        downloadCsv(response.data.filename, response.data.csv);
      } else if (response.error) {
        setMessage(messageFor(response.error, COPY.templateFailed));
      }
    } catch (error) {
      setMessage(messageFor(error, COPY.templateFailed));
    }
  }

  async function validate(): Promise<void> {
    setMessage(null);
    if (!file) {
      setMessage(COPY.noFile);
      return;
    }
    try {
      const response = await upload.mutateAsync({
        fields: { idempotencyKey: crypto.randomUUID() },
        file,
      });
      setImportId(response.import.id);
      setSnapshot(response.import);
      setPage(1);
    } catch (error) {
      setMessage(messageFor(error, COPY.uploadFailed));
    }
  }

  async function confirmCommit(): Promise<void> {
    if (!displayedImport) return;
    setMessage(null);
    try {
      const response = await commit.mutateAsync({
        contentHash: displayedImport.contentHash,
        idempotencyKey: crypto.randomUUID(),
      });
      setSnapshot(response.import);
    } catch (error) {
      setMessage(messageFor(error, COPY.commitFailed));
    }
  }

  async function cancelImport(): Promise<void> {
    setMessage(null);
    try {
      const response = await cancel.mutateAsync({});
      setSnapshot(response.import);
      setMessage(COPY.canceled);
    } catch (error) {
      setMessage(messageFor(error, COPY.cancelFailed));
    }
  }

  async function downloadReport(): Promise<void> {
    setMessage(null);
    try {
      const response = await report.mutateAsync();
      openDownload(response.report.downloadUrl);
    } catch (error) {
      setMessage(messageFor(error, COPY.reportFailed));
    }
  }

  if (!canView) {
    return (
      <SectionCard title={COPY.title}>
        <p role="alert" className="text-subhead-regular text-danger">
          {COPY.forbidden}
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={COPY.title}>
      <div className="flex flex-col gap-5">
        <p className="max-w-3xl text-subhead-regular text-fg-muted">
          {COPY.description}
        </p>
        {!canWrite ? (
          <p role="alert" className="text-subhead-regular text-danger">
            {COPY.readOnly}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 border-y border-border py-5 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-caption-1-regular text-fg">
            {COPY.chooseFile}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!canWrite}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-caption-1-regular text-fg"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void downloadTemplate()}
              loading={template.isFetching}
              loadingLabel={COPY.loadingTemplate}
            >
              {COPY.template}
            </Button>
            <Button
              type="button"
              onClick={() => void validate()}
              disabled={file === null || !canWrite}
              loading={upload.isPending}
              loadingLabel={COPY.validating}
            >
              {COPY.validate}
            </Button>
          </div>
        </div>
        {message ? (
          <p role="alert" className="text-subhead-regular text-danger">
            {message}
          </p>
        ) : null}
        {displayedImport ? (
          <div className="flex flex-col gap-4" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Tag
                  variant="fill"
                  tone={statusTone(displayedImport.status)}
                  size="sm"
                >
                  {statusLabel(displayedImport.status)}
                </Tag>
                <p className="text-caption-1-regular text-fg-muted">
                  {formatMessage(COPY.progress, {
                    processed: displayedImport.processedRowCount,
                    total: displayedImport.rowCount,
                  })}
                </p>
              </div>
              <p className="text-caption-1-regular text-fg-muted">
                {formatMessage(COPY.expires, {
                  timestamp: new Date(
                    displayedImport.expiresAt,
                  ).toLocaleString(),
                })}
              </p>
            </div>
            <Summary counts={displayedImport.counts} />
            {displayedImport.errorCode ? (
              <p role="alert" className="text-subhead-regular text-danger">
                {COPY.importAttention}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => void confirmCommit()}
                disabled={!canCommit}
                loading={commit.isPending}
                loadingLabel={COPY.committing}
              >
                {COPY.commit}
              </Button>
              {canWrite &&
              (displayedImport.status === "dry_run_completed" ||
                displayedImport.status === "committing") ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void cancelImport()}
                  loading={cancel.isPending}
                  loadingLabel={COPY.canceling}
                >
                  {COPY.cancel}
                </Button>
              ) : null}
              {canExport ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void downloadReport()}
                  loading={report.isPending}
                  loadingLabel={COPY.loadingReport}
                >
                  {COPY.report}
                </Button>
              ) : null}
            </div>
            <div className="border-t border-border pt-4">
              <h3 className="text-headline-semibold text-fg">
                {COPY.rowIssues}
              </h3>
              {rows.isPending ? (
                <p
                  role="status"
                  className="mt-3 text-subhead-regular text-fg-muted"
                >
                  {COPY.loadingRows}
                </p>
              ) : rows.isError ? (
                <div
                  role="alert"
                  className="mt-3 flex flex-wrap items-center gap-3"
                >
                  <p className="text-subhead-regular text-danger">
                    {COPY.rowsFailed}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => void rows.refetch()}
                  >
                    {COPY.retry}
                  </Button>
                </div>
              ) : rows.data?.rows.rows.length ? (
                <>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-caption-1-regular text-fg">
                      <thead className="border-b border-border text-fg-muted">
                        <tr>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {COPY.row}
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {COPY.action}
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {COPY.result}
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {COPY.record}
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {COPY.issues}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.data.rows.rows.map((row) => (
                          <tr
                            key={row.sourceRowNumber}
                            className="border-b border-border last:border-b-0"
                          >
                            <td className="px-2 py-3 tabular-nums">
                              {row.sourceRowNumber}
                            </td>
                            <td className="px-2 py-3 capitalize">
                              {row.proposedAction}
                            </td>
                            <td className="px-2 py-3 capitalize">
                              {row.result}
                            </td>
                            <td className="px-2 py-3">
                              {canonicalRecord(row)}
                            </td>
                            <td className="px-2 py-3">
                              {row.issues.length === 0
                                ? COPY.emptyIssue
                                : row.issues
                                    .map((issue) =>
                                      formatMessage(COPY.issue, {
                                        field: issue.field,
                                        message: issue.message,
                                      }),
                                    )
                                    .join(COPY.issueSeparator)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.data.rows.pageCount > 1 ? (
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-caption-1-regular text-fg-muted">
                        {COPY.page}{" "}
                        {formatMessage(COPY.pageProgress, {
                          page: rows.data.rows.page,
                          pageCount: rows.data.rows.pageCount,
                        })}
                      </p>
                      <div className="flex gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          tone="grey"
                          disabled={rows.data.rows.page <= 1}
                          onClick={() =>
                            setPage((value) => Math.max(1, value - 1))
                          }
                        >
                          {COPY.previousPage}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          tone="grey"
                          disabled={
                            rows.data.rows.page >= rows.data.rows.pageCount
                          }
                          onClick={() =>
                            setPage((value) =>
                              Math.min(
                                rows.data?.rows.pageCount ?? value,
                                value + 1,
                              ),
                            )
                          }
                        >
                          {COPY.nextPage}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-subhead-regular text-fg-muted">
                  {COPY.noIssues}
                </p>
              )}
            </div>
          </div>
        ) : null}
        {history.isError ? (
          <p role="alert" className="text-subhead-regular text-danger">
            {COPY.recentFailed}
          </p>
        ) : history.data?.imports.rows.length ? (
          <div className="border-t border-border pt-4">
            <h3 className="text-headline-semibold text-fg">{COPY.recent}</h3>
            <ul
              className="mt-3 divide-y divide-border"
              aria-label={COPY.recentAria}
            >
              {history.data.imports.rows.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Tag
                      variant="fill"
                      tone={statusTone(item.status)}
                      size="sm"
                    >
                      {statusLabel(item.status)}
                    </Tag>
                    <span className="text-caption-1-regular text-fg-muted">
                      {formatMessage(COPY.progress, {
                        processed: item.processedRowCount,
                        total: item.rowCount,
                      })}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => {
                      setImportId(item.id);
                      setSnapshot(item);
                      setPage(1);
                    }}
                  >
                    {COPY.review}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
