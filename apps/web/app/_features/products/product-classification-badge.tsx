import type {
  ProductClassification,
  ProductClassificationSummary,
} from "@repo/contracts/products";
import { cn } from "@repo/ui/cn";
export const CLASSIFICATION_LABELS: Record<ProductClassification, string> = {
  default: "Default",
  important_class_i: "Important Class I",
  important_class_ii: "Important Class II",
  critical: "Critical",
  out_of_scope: "Out of scope",
  undetermined: "Undetermined",
};

export function ProductClassificationBadge({
  latest,
  productVersion,
  loading = false,
  unavailable = false,
}: {
  latest?: ProductClassificationSummary | null;
  productVersion: number;
  loading?: boolean;
  unavailable?: boolean;
}) {
  const label = unavailable
    ? "Classification unavailable"
    : loading
      ? "Loading classification…"
      : latest
        ? `Provisional: ${CLASSIFICATION_LABELS[latest.classification]}${latest.productVersion !== productVersion ? " · Product changed" : ""}`
        : "Not classified";
  return (
    <span
      className={cn(
        "inline-flex rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-caption-1-regular text-fg-muted",
      )}
    >
      {label}
    </span>
  );
}
