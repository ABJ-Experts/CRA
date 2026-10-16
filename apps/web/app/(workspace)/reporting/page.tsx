import { Suspense } from "react";

import { ReportingObligationsContent } from "../../_features/reporting/reporting-obligations-content";

export default function ReportingPage() {
  return (
    <Suspense
      fallback={
        <p
          role="status"
          className="rounded-xl border border-border p-4 text-caption-1-regular text-fg-muted"
        >
          Loading reporting obligations…
        </p>
      }
    >
      <ReportingObligationsContent />
    </Suspense>
  );
}
