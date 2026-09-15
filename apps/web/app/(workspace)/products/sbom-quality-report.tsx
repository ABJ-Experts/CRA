"use client";

import type {
  SbomQualityDimension,
  SbomQualityFinding,
  SbomQualityReport,
} from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { Tag, type TagProps } from "@repo/ui/tag";
import { CircleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useSbomQualityFindingsQuery,
  useSbomQualityReportQuery,
} from "../../_features/sboms/sboms.queries";

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(
  status: SbomQualityReport["assessmentStatus"],
): TagProps["tone"] {
  if (status === "valid") return "green";
  if (status === "invalid") return "red";
  if (status === "warning" || status === "regression") return "orange";
  return "blue";
}

function findingTone(
  severity: SbomQualityFinding["severity"],
): TagProps["tone"] {
  if (severity === "error") return "red";
  if (severity === "warning") return "orange";
  return "blue";
}

function profileTone(
  status: NonNullable<SbomQualityReport["bsiProfile"]>["status"],
): TagProps["tone"] {
  if (status === "valid") return "green";
  if (status === "invalid") return "red";
  if (status === "warning") return "orange";
  return "blue";
}

function qualityErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You do not have permission to view SBOM quality results.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This SBOM quality report is unavailable.";
  }
  return "SBOM quality data is temporarily unavailable. Try again.";
}

function percentage(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 1,
  }).format(value);
}

function DimensionSummary({
  dimension,
}: Readonly<{ dimension: SbomQualityDimension }>) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-caption-1-semibold text-fg">
          {titleCase(dimension.id)}
        </p>
        <p className="text-caption-2-regular text-fg-muted">
          {dimension.satisfiedCount} of {dimension.eligibleCount} components or
          graph facts
        </p>
      </div>
      <div className="text-right">
        <p className="text-caption-1-semibold text-fg">
          {percentage(dimension.coveragePercent)}%
        </p>
        <p className="text-caption-2-regular text-fg-muted">
          {dimension.weight}% weight
        </p>
      </div>
      <p className="col-span-2 text-caption-2-regular text-fg-muted">
        {titleCase(dimension.status)}: score {percentage(dimension.score)}.
      </p>
    </li>
  );
}

function QualityState({ report }: Readonly<{ report: SbomQualityReport }>) {
  if (report.state === "failed") {
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-surface-subtle p-4"
      >
        <p className="text-subhead-semibold text-fg">Quality report failed.</p>
        <p className="mt-1 text-caption-1-regular text-danger">
          {report.error?.retryable ? "Retryable: " : ""}
          {report.error?.message ?? "Quality calculation could not finish."}
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="rounded-xl border border-border bg-surface-subtle p-4"
    >
      <p className="text-subhead-semibold text-fg">
        Quality report is {report.state}.
      </p>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        {report.progress.message}
      </p>
    </div>
  );
}

function RemediationTable({
  sourceId,
  enabled,
}: Readonly<{ sourceId: string; enabled: boolean }>) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [pages, setPages] = useState<readonly SbomQualityFinding[]>([]);
  const findings = useSbomQualityFindingsQuery(
    sourceId,
    { limit: 50, cursor },
    enabled,
  );

  useEffect(() => {
    setCursor(undefined);
    setPages([]);
  }, [sourceId]);

  useEffect(() => {
    if (!findings.data) return;
    setPages((current) => {
      if (cursor === undefined) return findings.data.findings;
      const known = new Set(current.map((finding) => finding.id));
      const appended = findings.data.findings.filter(
        (finding) => !known.has(finding.id),
      );
      return appended.length === 0 ? current : [...current, ...appended];
    });
  }, [cursor, findings.data]);

  return (
    <section aria-labelledby="sbom-quality-remediation-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="sbom-quality-remediation-heading"
            className="text-title-3-semibold text-fg"
          >
            Remediation guidance
          </h2>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Each item names the missing evidence or profile condition and how to
            address it.
          </p>
        </div>
        <Tag variant="cool" size="sm">
          {pages.length}
        </Tag>
      </div>
      {findings.isPending ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading remediation guidance...
        </p>
      ) : findings.isError ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {qualityErrorMessage(findings.error)}
        </p>
      ) : pages.length === 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          No remediation items were retained for this report.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <caption className="sr-only">
              SBOM quality remediation guidance
            </caption>
            <thead className="bg-surface">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-caption-2-uppercase text-fg-muted"
                >
                  Severity
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-caption-2-uppercase text-fg-muted"
                >
                  Finding
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-caption-2-uppercase text-fg-muted"
                >
                  Evidence
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-caption-2-uppercase text-fg-muted"
                >
                  Remediation
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((finding) => (
                <tr
                  key={finding.id}
                  className="border-t border-border align-top"
                >
                  <td className="px-3 py-3">
                    <Tag
                      variant="dot"
                      tone={findingTone(finding.severity)}
                      size="sm"
                    >
                      {titleCase(finding.severity)}
                    </Tag>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-mono text-caption-1-semibold text-fg">
                      {finding.ruleId ?? finding.code}
                    </p>
                    <p className="mt-1 text-caption-2-regular text-fg-muted">
                      {titleCase(finding.kind)}
                      {finding.dimension
                        ? ` · ${titleCase(finding.dimension)}`
                        : ""}
                    </p>
                  </td>
                  <td className="max-w-72 break-words px-3 py-3 text-caption-2-regular text-fg-muted">
                    {finding.sourcePath ??
                      finding.actual ??
                      "Document-level evidence"}
                  </td>
                  <td className="max-w-96 break-words px-3 py-3 text-caption-1-regular text-fg">
                    {finding.remediation}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {findings.data?.nextCursor ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => setCursor(findings.data?.nextCursor ?? undefined)}
        >
          Load more guidance
        </Button>
      ) : null}
    </section>
  );
}

function QualityReportCompleted({
  report,
  enabled,
}: Readonly<{ report: SbomQualityReport; enabled: boolean }>) {
  const dimensionsById = useMemo(
    () =>
      new Map(report.dimensions.map((dimension) => [dimension.id, dimension])),
    [report.dimensions],
  );
  const legalFloor = dimensionsById.get("top_level_dependency");
  const transitiveDepth = dimensionsById.get("transitive_depth");
  const baselineMessage =
    report.baseline?.status === "available"
      ? `Previous report scored ${percentage(report.baseline.totalScore)}.`
      : report.baseline?.status === "first_document"
        ? "This is the first document in this release lineage."
        : "No eligible completed baseline is available.";

  return (
    <section aria-labelledby="sbom-quality-heading" className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="sbom-quality-heading"
            className="text-title-2-semibold text-fg"
          >
            SBOM quality report
          </h2>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Explainable technical evidence quality; it is not legal advice or
            release approval.
          </p>
        </div>
        <Tag variant="dot" tone={statusTone(report.assessmentStatus)} size="sm">
          {titleCase(report.assessmentStatus ?? "warning")}
        </Tag>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <section
          className="rounded-xl border border-border bg-surface-subtle p-4"
          aria-labelledby="sbom-quality-score-heading"
        >
          <h3
            id="sbom-quality-score-heading"
            className="text-subhead-semibold text-fg"
          >
            Overall quality
          </h3>
          <p className="mt-3 text-title-1-semibold text-fg">
            {percentage(report.totalScore ?? 0)}%
          </p>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Formula: {report.formulaVersion}
          </p>
        </section>
        <section
          className="rounded-xl border border-border bg-surface-subtle p-4"
          aria-labelledby="sbom-quality-floor-heading"
        >
          <h3
            id="sbom-quality-floor-heading"
            className="text-subhead-semibold text-fg"
          >
            CRA legal floor
          </h3>
          <p className="mt-3 text-title-1-semibold text-fg">
            {percentage(legalFloor?.coveragePercent ?? 0)}%
          </p>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Top-level dependency coverage remains separate from depth.
          </p>
        </section>
        <section
          className="rounded-xl border border-border bg-surface-subtle p-4"
          aria-labelledby="sbom-quality-depth-heading"
        >
          <h3
            id="sbom-quality-depth-heading"
            className="text-subhead-semibold text-fg"
          >
            Transitive depth
          </h3>
          <p className="mt-3 text-title-1-semibold text-fg">
            {report.inputs?.maximumDepth ?? 0}
          </p>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Depth measure: {percentage(transitiveDepth?.coveragePercent ?? 0)}%
          </p>
        </section>
        <section
          className="rounded-xl border border-border bg-surface-subtle p-4"
          aria-labelledby="sbom-quality-bsi-heading"
        >
          <h3
            id="sbom-quality-bsi-heading"
            className="text-subhead-semibold text-fg"
          >
            BSI profile
          </h3>
          <div className="mt-3">
            <Tag
              variant="dot"
              tone={profileTone(report.bsiProfile?.status ?? "unavailable")}
              size="sm"
            >
              {titleCase(report.bsiProfile?.status ?? "unavailable")}
            </Tag>
          </div>
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            {report.bsiProfile?.enabled
              ? `${report.bsiProfile.findingCount} profile findings · ${report.bsiProfile.rulesetVersion}`
              : "Optional tenant profile is disabled."}
          </p>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section
          className="rounded-xl border border-border bg-surface-subtle p-4"
          aria-labelledby="sbom-quality-coverage-heading"
        >
          <h3
            id="sbom-quality-coverage-heading"
            className="text-title-3-semibold text-fg"
          >
            Coverage dimensions
          </h3>
          <ul className="mt-2">
            {report.dimensions.map((dimension) => (
              <DimensionSummary key={dimension.id} dimension={dimension} />
            ))}
          </ul>
        </section>
        <section
          className="rounded-xl border border-border bg-surface-subtle p-4"
          aria-labelledby="sbom-quality-regression-heading"
        >
          <div className="flex items-center gap-2">
            <CircleAlert aria-hidden="true" className="size-5 text-fg-muted" />
            <h3
              id="sbom-quality-regression-heading"
              className="text-title-3-semibold text-fg"
            >
              Baseline and regression
            </h3>
          </div>
          <p className="mt-3 text-caption-1-regular text-fg">
            {baselineMessage}
          </p>
          {report.regression?.status === "regression" ? (
            <p className="mt-3 text-caption-1-regular text-warning">
              Quality declined by{" "}
              {percentage(Math.abs(report.regression.totalScoreDelta))} points.
              Changed dimensions:{" "}
              {report.regression.changedDimensions.map(titleCase).join(", ") ||
                "recorded quality inputs"}
              .
            </p>
          ) : (
            <p className="mt-3 text-caption-1-regular text-fg-muted">
              No material quality regression was recorded.
            </p>
          )}
        </section>
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <RemediationTable sourceId={report.sourceId} enabled={enabled} />
      </div>
    </section>
  );
}

export function SbomQualityReport({
  sourceId,
  enabled,
}: Readonly<{ sourceId: string; enabled: boolean }>) {
  const quality = useSbomQualityReportQuery(sourceId, enabled);

  if (quality.isPending) {
    return (
      <p role="status" className="text-caption-1-regular text-fg-muted">
        Loading SBOM quality report...
      </p>
    );
  }
  if (quality.isError || !quality.data) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-surface-subtle p-4"
      >
        <p className="text-caption-1-regular text-danger">
          {qualityErrorMessage(quality.error)}
        </p>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => void quality.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (quality.data.report.state !== "completed") {
    return <QualityState report={quality.data.report} />;
  }
  return (
    <QualityReportCompleted report={quality.data.report} enabled={enabled} />
  );
}
