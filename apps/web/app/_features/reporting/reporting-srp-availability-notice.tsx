import { Tag } from "@repo/ui/tag";

import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

export function ReportingSrpAvailabilityNotice() {
  return (
    <div
      aria-label="ENISA SRP submission availability"
      aria-live="polite"
      className="mt-4"
      role="status"
    >
      <SectionCard bodyClassName="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h4 className="text-caption-1-semibold text-fg">
            ENISA SRP submission
          </h4>
          <Tag size="sm" tone="orange" variant="dot">
            Manual filing required
          </Tag>
        </div>
        <p className="text-caption-1-regular text-fg">
          Automated SRP submission is unavailable. ENISA has not published a
          supported API.
        </p>
        <p className="text-caption-1-regular text-fg-muted">
          Use the approved Signed manual package to file through the ENISA SRP
          interface, then use Record external filing to preserve the reference
          and receipt as immutable evidence.
        </p>
      </SectionCard>
    </div>
  );
}
