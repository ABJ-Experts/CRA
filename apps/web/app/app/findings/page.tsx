import {
  PageHeading,
  SectionCard,
  Stagger,
  StaggerItem,
} from "../../dashboard/_components/dashboard-chrome";
import { apiGet, type FindingPageData } from "../_lib/api";
import { FindingsQueue } from "./findings-queue";

/**
 * Triage queue.
 *
 * BRD FR-FE-003 requires this to stay interactive at 100,000 rows, which means
 * virtualisation and a client component. This is the server-rendered first cut:
 * it establishes the shape and proves the data path, and is honest about being
 * unpaginated rather than pretending the cursor is wired.
 */

export const dynamic = "force-dynamic";

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
        ) : (
          <StaggerItem>
            <SectionCard>
              <FindingsQueue initial={data ?? { items: [], nextCursor: null, hasMore: false }} />
            </SectionCard>
          </StaggerItem>
        )}
      </Stagger>
    </div>
  );
}
