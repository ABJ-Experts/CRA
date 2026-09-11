import { Tag } from "@repo/ui/tag";

import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

export function ReportingRehearsalNotice() {
  return (
    <div
      aria-label="Synthetic rehearsal"
      aria-live="polite"
      className="mt-4"
      role="status"
    >
      <SectionCard bodyClassName="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h4 className="text-caption-1-semibold text-fg">
            Synthetic rehearsal
          </h4>
          <Tag size="sm" tone="orange" variant="dot">
            Not a legal filing
          </Tag>
        </div>
        <p className="text-caption-1-regular text-fg">
          This reporting lifecycle is synthetic. Packages, evidence, and manual
          submissions are marked REHEARSAL and never notify a regulator.
        </p>
        <p className="text-caption-1-regular text-fg-muted">
          Start a separate real reporting workflow and record a new human
          awareness assertion before making any legal filing.
        </p>
      </SectionCard>
    </div>
  );
}
