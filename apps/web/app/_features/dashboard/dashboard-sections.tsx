import type { DashboardProjection } from "./dashboard.queries";
import type { DashboardObligationRow } from "@repo/contracts/dashboard/types";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import type { ReactNode } from "react";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { countdownLabel } from "./dashboard-clock";

type Section =
  | DashboardProjection["findings"]
  | DashboardProjection["obligations"]
  | DashboardProjection["readiness"]
  | DashboardProjection["sbomCoverage"]
  | DashboardProjection["ingestion"]
  | DashboardProjection["feedFreshness"];
const linkClass =
  "text-subhead-medium text-active-500 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded";
export function SourceState({ section }: { section: Section }) {
  const copy = {
    restricted: "Your current access does not include this source.",
    not_initialized: "This source has not been initialized.",
    unavailable:
      "This source is temporarily unavailable. Refresh to try again.",
    empty: "No records are available for this source.",
    stale: "Source data is stale. Check the source before acting.",
    available: "",
  };
  return (
    <div className="mb-3 space-y-2">
      {section.state !== "available" ? (
        <p
          role="status"
          className={cn(
            "text-subhead-regular text-fg",
            section.state === "stale" && "font-medium",
          )}
        >
          {copy[section.state]}
        </p>
      ) : null}
      {section.observedAt ? (
        <p className="text-caption-1-regular text-fg">
          Source observed{" "}
          <time dateTime={section.observedAt}>
            {new Date(section.observedAt).toLocaleString()}
          </time>
          {section.updatedAt
            ? ` · Updated ${new Date(section.updatedAt).toLocaleString()}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
export function findingsHref(severity?: string, productId?: string) {
  const query = new URLSearchParams({ openOnly: "true" });
  if (severity) query.set("severity", severity);
  if (productId) query.set("productId", productId);
  return `/findings?${query}`;
}
export function obligationHref(row: DashboardObligationRow) {
  return `/reporting?obligationId=${row.obligationId}&stageId=${row.stageId}`;
}
export function DashboardCountdown({
  section,
  now,
}: {
  section: DashboardProjection["obligations"];
  now: number;
}) {
  const rows = "data" in section ? section.data.rows : [];
  const active = rows.filter(
    (row) =>
      row.obligationStatus === "active" &&
      ["overdue", "running", "pending_anchor"].includes(row.state),
  );
  const ordered = [...active].sort((a, b) => {
    const rank = (row: DashboardObligationRow) =>
      row.state === "overdue" ? 0 : row.state === "running" ? 1 : 2;
    return rank(a) - rank(b) || (a.dueAt ?? "z").localeCompare(b.dueAt ?? "z");
  });
  const first = ordered[0];
  return (
    <section
      data-testid="dashboard-countdown"
      aria-labelledby="dashboard-deadlines-title"
      className={cn("rounded-xl border border-border bg-surface p-6 sm:p-8")}
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 id="dashboard-deadlines-title" className="text-h4 text-fg">
            Regulatory deadlines
          </h2>
          <p className="mt-2 max-w-prose text-subhead-regular text-fg">
            Act on the earliest reporting stage. Deadlines and breach history
            come from the reporting record.
          </p>
        </div>
        <Link className={linkClass} href="/reporting">
          Open reporting obligations
        </Link>
      </div>
      <SourceState section={section} />
      {first ? (
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-border-strong pt-6">
          <div>
            <p className="text-subhead-semibold text-fg">
              {first.productName ?? "Reporting obligation"} ·{" "}
              {first.kind.replaceAll("_", " ")}
            </p>
            <p
              className={cn(
                "mt-2 text-h3 tabular-nums text-fg",
                first.state === "overdue" && "text-danger",
              )}
            >
              {countdownLabel(first.dueAt, first.state, now)}
            </p>
            <p className="mt-2 text-subhead-regular text-fg">
              {first.dueAt
                ? `Due ${new Date(first.dueAt).toLocaleString()}`
                : "The source has not recorded the trigger yet."}
              {first.breachedAt ? " · Recorded deadline breach" : ""}
            </p>
            {first.elapsedPercent !== null ? (
              <p className="mt-2 text-subhead-regular text-fg">
                Source elapsed progress: {first.elapsedPercent.toFixed(0)}%
              </p>
            ) : null}
          </div>
          <Link href={obligationHref(first)} className={linkClass}>
            Open this stage
          </Link>
        </div>
      ) : "data" in section ? (
        <p className="mt-6 text-h5 text-fg">No active reporting stages</p>
      ) : null}
    </section>
  );
}
function OperationalTable({
  label,
  headings,
  children,
}: {
  label: string;
  headings: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        aria-label={label}
        className="w-full text-left text-subhead-regular text-fg"
      >
        <thead>
          <tr>
            {headings.map((heading) => (
              <th
                key={heading}
                scope="col"
                className="border-b border-border px-3 py-3 text-subhead-semibold"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const cell = "border-b border-border px-3 py-4 align-top";
export function DashboardFindings({
  section,
  productId,
}: {
  section: DashboardProjection["findings"];
  productId?: string;
}) {
  return (
    <SectionCard
      title="Open findings"
      action={
        <Link className={linkClass} href={findingsHref(undefined, productId)}>
          Triage open findings
        </Link>
      }
    >
      <SourceState section={section} />
      {"data" in section ? (
        <>
          <p className="mb-4 text-subhead-regular text-fg">
            {section.data.openCount.toLocaleString()} open ·{" "}
            {section.data.suppressedOpenCount.toLocaleString()} suppressed and
            still open
          </p>
          <OperationalTable
            label="Open findings by severity"
            headings={["Severity", "Open findings", "Distribution", "Action"]}
          >
            {Object.entries(section.data.bySeverity).map(
              ([severity, count]) => (
                <tr key={severity}>
                  <th
                    scope="row"
                    className={cn(cell, "capitalize font-medium")}
                  >
                    {severity}
                  </th>
                  <td className={cn(cell, "tabular-nums")}>
                    {count.toLocaleString()}
                  </td>
                  <td className={cell}>
                    <div
                      aria-hidden="true"
                      className="h-2 min-w-24 rounded bg-surface-muted"
                    >
                      <div
                        className="h-2 rounded bg-active-500"
                        style={{
                          width: `${section.data.openCount ? (count / section.data.openCount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td className={cell}>
                    <Link
                      className={linkClass}
                      href={findingsHref(severity, productId)}
                    >
                      Triage {severity}
                    </Link>
                  </td>
                </tr>
              ),
            )}
          </OperationalTable>
        </>
      ) : null}
    </SectionCard>
  );
}
export function DashboardObligations({
  section,
  now,
}: {
  section: DashboardProjection["obligations"];
  now: number;
}) {
  return (
    <SectionCard title="Reporting stages">
      <SourceState section={section} />
      {"data" in section && section.data.rows.length > 0 ? (
        <OperationalTable
          label="Reporting obligation stages"
          headings={["Product / stage", "State", "Deadline", "Action"]}
        >
          {section.data.rows.map((row) => (
            <tr key={row.stageId}>
              <th scope="row" className={cn(cell, "font-medium")}>
                {row.productName ?? "Product unavailable"}
                <span className="block">{row.kind.replaceAll("_", " ")}</span>
              </th>
              <td className={cell}>
                {row.state.replaceAll("_", " ")}
                {row.breachedAt ? (
                  <span className="block">Recorded breach</span>
                ) : null}
              </td>
              <td className={cn(cell, "tabular-nums")}>
                {countdownLabel(
                  row.dueAt,
                  row.obligationStatus === "cancelled"
                    ? "cancelled"
                    : row.state,
                  now,
                )}
              </td>
              <td className={cell}>
                <Link className={linkClass} href={obligationHref(row)}>
                  Open stage
                </Link>
              </td>
            </tr>
          ))}
        </OperationalTable>
      ) : null}
    </SectionCard>
  );
}
export function DashboardReadiness({
  section,
}: {
  section: DashboardProjection["readiness"];
}) {
  return (
    <SectionCard title="Technical-file readiness">
      <p className="mb-4 text-subhead-regular text-fg">
        Completed applicable sections. This is progress, not a compliance
        certification.
      </p>
      <SourceState section={section} />
      {"data" in section ? (
        <ul className="divide-y divide-border">
          {section.data.rows.map((row) => (
            <li
              key={row.productId}
              className="flex flex-wrap items-start justify-between gap-4 py-4"
            >
              <div>
                <Link
                  href={`/products/${row.productId}/posture`}
                  className={linkClass}
                >
                  {row.productName}
                </Link>
                <p className="mt-2 text-subhead-regular text-fg">
                  {"state" in row ? (
                    row.state.replaceAll("_", " ")
                  ) : (
                    <>
                      {row.completeSections} / {row.applicableSections} sections
                      ·{" "}
                      {row.percent === null
                        ? "Progress unavailable"
                        : `${row.percent.toFixed(0)}%`}{" "}
                      · {row.status.replaceAll("_", " ")}
                    </>
                  )}
                </p>
              </div>
              <div className="flex max-w-lg flex-col gap-2">
                {"state" in row ? (
                  <p className="text-subhead-regular text-fg">
                    Readiness evidence is {row.state.replaceAll("_", " ")}.
                  </p>
                ) : (
                  <>
                    {[...row.gaps]
                      .sort((a, b) => a.priority - b.priority)
                      .slice(0, 3)
                      .map((gap) => (
                        <Link
                          key={`${gap.sectionKey}-${gap.code}`}
                          className={linkClass}
                          href={`/products/${row.productId}/technical-file?section=${gap.sectionKey}`}
                        >
                          {gap.actionLabel}
                        </Link>
                      ))}
                    {row.gaps.length === 0 ? (
                      <Link
                        className={linkClass}
                        href={`/products/${row.productId}/technical-file`}
                      >
                        Open technical file
                      </Link>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}
export function DashboardCoverage({
  section,
}: {
  section: DashboardProjection["sbomCoverage"];
}) {
  return (
    <SectionCard title="SBOM coverage">
      <SourceState section={section} />
      {"data" in section ? (
        <>
          <p className="text-h4 tabular-nums text-fg">
            {section.data.coveredReleases} / {section.data.eligibleReleases}{" "}
            releases
          </p>
          <p className="mt-2 text-subhead-regular text-fg">
            {section.data.percent === null
              ? "No eligible releases"
              : `${section.data.percent.toFixed(0)}% covered`}{" "}
            · Releases currently on the market with a valid completed SBOM.
          </p>
        </>
      ) : null}
      <p className="mt-4 text-subhead-regular text-fg">
        Coverage describes document availability, not document quality.
      </p>
    </SectionCard>
  );
}
export function DashboardIngestion({
  section,
}: {
  section: DashboardProjection["ingestion"];
}) {
  return (
    <SectionCard title="SBOM ingestion">
      <SourceState section={section} />
      {"data" in section && section.data.rows.length > 0 ? (
        <OperationalTable
          label="SBOM ingestion status"
          headings={["Product", "Status", "Updated"]}
        >
          {section.data.rows.map((row) => (
            <tr key={row.jobId}>
              <th scope="row" className={cn(cell, "font-medium")}>
                <Link href={`/products/${row.productId}`} className={linkClass}>
                  {row.productName}
                </Link>
              </th>
              <td className={cell}>{row.status.replaceAll("_", " ")}</td>
              <td className={cell}>
                <time dateTime={row.updatedAt}>
                  {new Date(row.updatedAt).toLocaleString()}
                </time>
              </td>
            </tr>
          ))}
        </OperationalTable>
      ) : null}
    </SectionCard>
  );
}
export function DashboardFeeds({
  section,
}: {
  section: DashboardProjection["feedFreshness"];
}) {
  return (
    <SectionCard title="Feed freshness">
      <SourceState section={section} />
      {"data" in section ? (
        <ul className="divide-y divide-border">
          {section.data.map((feed) => (
            <li
              key={feed.feedKey}
              className="flex flex-wrap justify-between gap-3 py-3 text-subhead-regular text-fg"
            >
              <span>
                {feed.feedKey} · {feed.status} · {feed.freshness}
              </span>
              <span>
                {feed.lastSuccessfulSyncAt
                  ? `Last successful sync ${new Date(feed.lastSuccessfulSyncAt).toLocaleString()}`
                  : "No successful sync recorded"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}
