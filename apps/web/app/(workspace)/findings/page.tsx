import { FindingTriageContent } from "../../_features/findings/triage-content";
import { Suspense } from "react";

export default function FindingsPage() {
  return (
    <Suspense
      fallback={
        <p
          role="status"
          className="rounded-xl border border-border p-4 text-caption-1-regular text-fg-muted"
        >
          Loading triage workspace…
        </p>
      }
    >
      <FindingTriageContent />
    </Suspense>
  );
}
