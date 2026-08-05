import { Tag } from "@repo/ui/tag";
import {
  PageHeading,
  SectionCard,
  Stagger,
  StaggerItem,
} from "../../dashboard/_components/dashboard-chrome";
import { apiGet, type FindingPageData } from "../_lib/api";

/**
 * Triage queue.
 *
 * BRD FR-FE-003 requires this to stay interactive at 100,000 rows, which means
 * virtualisation and a client component. This is the server-rendered first cut:
 * it establishes the shape and proves the data path, and is honest about being
 * unpaginated rather than pretending the cursor is wired.
 */

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, "red" | "orange" | "blue" | "purple"> = {
  critical: "red",
  high: "orange",
  medium: "orange",
  low: "blue",
};

export default async function AppFindingsPage() {
  const { data, error } = await apiGet<FindingPageData>("/findings?limit=50");
  const items = data?.items ?? [];

  return (
    <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
      <PageHeading
        title="Triage queue"
        subtitle={
          error
            ? undefined
            : `${items.length} finding${items.length === 1 ? "" : "s"} awaiting disposition.`
        }
      />

      <Stagger className="flex flex-col gap-4">
        {error ? (
          <StaggerItem>
            <SectionCard>
              <p className="text-caption-1-regular text-danger-fg" role="alert">
                {error}
              </p>
            </SectionCard>
          </StaggerItem>
        ) : items.length === 0 ? (
          <StaggerItem>
            <SectionCard>
              <p className="text-caption-1-regular text-fg-muted">
                Nothing to triage. Findings appear once an uploaded SBOM is
                matched against the advisory feed.
              </p>
            </SectionCard>
          </StaggerItem>
        ) : (
          items.map((f) => (
            <StaggerItem key={f.id}>
              <SectionCard bodyClassName="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-caption-1-semibold text-fg">
                      {f.advisoryId ?? f.id.slice(0, 12)}
                    </span>
                    {f.severity ? (
                      <Tag variant="fill" tone={SEVERITY_TONE[f.severity] ?? "purple"}>{f.severity}</Tag>
                    ) : null}
                    {f.kev ? (
                      <Tag variant="fill" tone="red">
                        KEV
                      </Tag>
                    ) : null}
                    {f.state ? <Tag>{f.state}</Tag> : null}
                    {f.vexStatus ? <Tag>vex: {f.vexStatus}</Tag> : null}
                  </div>

                  {f.matchReason ? (
                    <span className="shrink-0 text-caption-2-regular text-fg-muted">
                      {f.matchReason}
                      {typeof f.matchConfidence === "number"
                        ? ` · ${Math.round(f.matchConfidence * 100)}%`
                        : ""}
                    </span>
                  ) : null}
                </div>
              </SectionCard>
            </StaggerItem>
          ))
        )}
      </Stagger>
    </div>
  );
}
