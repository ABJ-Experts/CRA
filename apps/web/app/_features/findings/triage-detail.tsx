"use client";

import type { VulnerabilityTriageDetailResponse } from "@repo/contracts/vulnerabilities";
import { Button } from "@repo/ui/button";
import { Tag, type TagProps } from "@repo/ui/tag";

import { FindingAssessment } from "./finding-assessment";

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function severityTone(severity: string): TagProps["tone"] {
  if (severity === "critical") return "red";
  if (severity === "high") return "orange";
  if (severity === "medium") return "orange";
  return "purple";
}

export function FindingTriageDetail({
  detail,
  onClose,
}: Readonly<{
  detail: VulnerabilityTriageDetailResponse["detail"];
  onClose: () => void;
}>) {
  const finding = detail.finding;
  const intelligence = finding.intelligence;
  const cvssSeverity =
    intelligence.cvss.preferred === null
      ? "unknown"
      : intelligence.cvss.preferred.baseScore >= 9
        ? "critical"
        : intelligence.cvss.preferred.baseScore >= 7
          ? "high"
          : intelligence.cvss.preferred.baseScore >= 4
            ? "medium"
            : "low";
  return (
    <aside
      className="rounded-xl border border-border bg-canvas p-5 shadow-sm"
      aria-labelledby="finding-detail-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption-2-uppercase text-fg-subtle">
            Finding detail
          </p>
          <h2
            id="finding-detail-heading"
            className="mt-1 break-words font-mono text-h5 text-fg"
          >
            {finding.advisoryId}
          </h2>
        </div>
        <Button size="sm" variant="gap" tone="grey" onClick={onClose}>
          Close detail
        </Button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Fact
          label="Product / release"
          value={`${finding.productName} / ${finding.releaseName}`}
        />
        <Fact
          label="Match"
          value={
            finding.matchMethod === "purl_osv"
              ? "PURL-first OSV"
              : "CPE fallback NVD"
          }
        />
        <Fact
          label="Comparator"
          value={`${finding.comparator.name} ${finding.comparator.version}`}
        />
        <Fact
          label="Component identity"
          value={finding.componentIdentity}
          mono
        />
      </div>

      <section className="mt-6" aria-labelledby="finding-intelligence-heading">
        <h3
          id="finding-intelligence-heading"
          className="text-subhead-semibold text-fg"
        >
          Advisory enrichment
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Tag variant="dot" tone={severityTone(cvssSeverity)}>
            {titleCase(cvssSeverity)}
          </Tag>
          <Tag
            variant="dot"
            tone={intelligence.kev.status === "listed" ? "red" : "purple"}
          >
            KEV {titleCase(intelligence.kev.status)}
          </Tag>
          <Tag variant="dot" tone="purple">
            {intelligence.epss.value === null
              ? "EPSS unknown"
              : `EPSS ${(intelligence.epss.value * 100).toFixed(2)}%`}
          </Tag>
        </div>
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          {intelligence.epss.value === null
            ? "No EPSS probability is available; unknown is not treated as zero."
            : `EPSS observation: ${intelligence.epss.observationDate ?? "date unavailable"}.`}
        </p>
      </section>

      <section className="mt-6" aria-labelledby="dependency-path-heading">
        <h3
          id="dependency-path-heading"
          className="text-subhead-semibold text-fg"
        >
          Dependency path
        </h3>
        {detail.componentOccurrences.length === 0 ? (
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            No dependency-path evidence was retained for this finding.
          </p>
        ) : (
          <ul className="mt-2 grid gap-2" aria-label="Component occurrences">
            {detail.componentOccurrences.map((occurrence) => (
              <li
                key={`${occurrence.documentId}-${occurrence.componentId}`}
                className="rounded-lg bg-surface-muted px-3 py-2 text-caption-1-regular text-fg"
              >
                <span className="font-mono">
                  {occurrence.purl ?? occurrence.identity}
                </span>
                <span className="text-fg-muted">
                  {" "}
                  · {occurrence.version ?? "version unavailable"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" aria-labelledby="finding-evidence-heading">
        <h3
          id="finding-evidence-heading"
          className="text-subhead-semibold text-fg"
        >
          Evidence and review
        </h3>
        <dl className="mt-3 grid gap-3 text-caption-1-regular">
          <Evidence
            label="Reachability"
            value={
              detail.reachability === null
                ? "No reachability evidence is retained."
                : detail.reachability.reachability === null
                  ? `Unknown — ${detail.reachability.analyzerSupport.state}`
                  : titleCase(detail.reachability.reachability.verdict)
            }
          />
          <Evidence
            label="Advisory review"
            value={
              detail.advisoryReview === null
                ? "No advisory review is retained."
                : titleCase(detail.advisoryReview.state)
            }
          />
          <Evidence
            label="Source assertions"
            value={
              detail.advisoryReview === null ||
              detail.advisoryReview.sourceAssertions.length === 0
                ? "None retained"
                : `${detail.advisoryReview.sourceAssertions.length} retained`
            }
          />
        </dl>
      </section>

      {finding.humanAssessment !== null ? (
        <section className="mt-6" aria-labelledby="legacy-assessment-heading">
          <h3
            id="legacy-assessment-heading"
            className="text-subhead-semibold text-fg"
          >
            Matcher applicability evidence
          </h3>
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            {titleCase(finding.humanAssessment.verdict)} · recorded{" "}
            {formatInstant(finding.humanAssessment.assessedAt)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-caption-1-regular text-fg">
            {finding.humanAssessment.rationale}
          </p>
        </section>
      ) : null}

      <FindingAssessment findingId={finding.id} />

      <section className="mt-6" aria-labelledby="history-heading">
        <h3 id="history-heading" className="text-subhead-semibold text-fg">
          Advisory history
        </h3>
        {detail.history.length === 0 ? (
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            No advisory re-evaluation events are retained.
          </p>
        ) : (
          <ul
            className="mt-2 grid gap-2"
            aria-label="Advisory re-evaluation history"
          >
            {detail.history.map((event) => (
              <li
                key={event.id}
                className="rounded-lg border border-border p-3 text-caption-1-regular text-fg"
              >
                <span className="font-medium">
                  {titleCase(event.transition)}
                </span>
                <span className="text-fg-muted">
                  {" "}
                  · {formatInstant(event.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" aria-labelledby="related-findings-heading">
        <h3
          id="related-findings-heading"
          className="text-subhead-semibold text-fg"
        >
          Related findings
        </h3>
        {detail.relatedFindings.length === 0 ? (
          <p className="mt-2 text-caption-1-regular text-fg-muted">
            No other authorized findings are related to this advisory.
          </p>
        ) : (
          <ul className="mt-2 grid gap-2" aria-label="Related findings">
            {detail.relatedFindings.map((related) => (
              <li
                key={related.id}
                className="rounded-lg border border-border p-3 text-caption-1-regular text-fg"
              >
                <span className="font-mono">{related.advisoryId}</span>
                <span className="text-fg-muted">
                  {" "}
                  · {related.productName} · {related.releaseName}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div>
      <dt className="text-caption-2-uppercase text-fg-subtle">{label}</dt>
      <dd
        className={`mt-1 break-words text-caption-1-regular text-fg ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
function Evidence({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  );
}
