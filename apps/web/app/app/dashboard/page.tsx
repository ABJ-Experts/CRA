import { PageHeading, SectionCard, Stagger, StaggerItem } from "../../dashboard/_components/dashboard-chrome";
import { apiGet, type DashboardData } from "../_lib/api";
import { SeverityBreakdown } from "./severity-breakdown";

/**
 * The product dashboard: CRA posture at a glance.
 *
 * Reuses the template's PageHeading / SectionCard / Stagger so this screen and
 * the demo dashboards are visibly one product rather than two apps sharing a
 * domain.
 */

export const dynamic = "force-dynamic";

const SEVERITIES = [
  { key: "critical", label: "Critical", dot: "bg-danger-500" },
  { key: "high", label: "High", dot: "bg-warning-500" },
  { key: "medium", label: "Medium", dot: "bg-warning-400" },
  { key: "low", label: "Low", dot: "bg-info-500" },
  { key: "unknown", label: "Unknown", dot: "bg-fg-subtle" },
] as const;

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "danger";
}) {
  return (
    <SectionCard>
      <p className="text-caption-2-semibold uppercase tracking-wide text-fg-muted">{label}</p>
      <p
        className={`mt-2 text-h3 ${tone === "danger" ? "text-danger-fg" : "text-fg"}`}
        data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {value}
      </p>
      <p className="mt-1 text-caption-1-regular text-fg-muted">{hint}</p>
    </SectionCard>
  );
}

export default async function AppDashboardPage() {
  const { data, error } = await apiGet<DashboardData>("/dashboard");

  if (error || !data) {
    return (
      <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
        <PageHeading title="Dashboard" />
        <SectionCard>
          <p className="text-caption-1-regular text-danger-fg" role="alert">
            {error ?? "Could not load the dashboard."}
          </p>
        </SectionCard>
      </div>
    );
  }

  const counts = SEVERITIES.map((s) => ({
    ...s,
    count: data.findingsBySeverity[s.key],
  }));
  const open = counts.reduce((sum, s) => sum + s.count, 0);
  const cov = data.sbomCoverage;
  const ing = data.ingestionHealth;

  return (
    <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
      <PageHeading
        title="Dashboard"
        subtitle={`Product-security posture and Cyber Resilience Act reporting at a glance · as of ${new Date(
          data.generatedAt,
        ).toLocaleString("en-GB", { timeZone: "UTC", timeZoneName: "short" })}`}
      />

      <Stagger className="flex flex-col gap-6">
        <StaggerItem className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <SectionCard title="Findings by severity" className="lg:col-span-2">
            <SeverityBreakdown counts={counts} open={open} />
          </SectionCard>

          <div className="flex flex-col gap-6">
            <Stat
              label="Actively exploited (KEV)"
              value={String(data.kevOpenCount)}
              hint="Open findings on the CISA KEV list"
              tone={data.kevOpenCount > 0 ? "danger" : undefined}
            />
            <Stat
              label="SBOM coverage"
              value={`${cov.releasesWithSbom}/${cov.releases}`}
              hint={`releases across ${cov.products} products · Ingestion ${ing.valid} valid · ${ing.validWithWarnings} warnings · ${ing.invalid} invalid`}
            />
          </div>
        </StaggerItem>

        <StaggerItem>
          <SectionCard title="Active reporting obligations">
            {data.activeObligations.length === 0 ? (
              /* FR-FE-004: an empty state explains the next useful action rather
               * than announcing emptiness. */
              <p className="text-caption-1-regular text-fg-muted">
                No open obligations. A KEV finding on a marketed product opens one.
              </p>
            ) : (
              <p className="text-caption-1-regular text-fg">
                {data.activeObligations.length} open
              </p>
            )}
          </SectionCard>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
