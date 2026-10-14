import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import type {
  SupportDiagnosticPreview,
  SupportDiagnosticSelection,
} from "@repo/contracts/support-diagnostics/types";
import {
  defaultDiagnosticSelection,
  diagnosticPanel,
} from "./support-diagnostics";
const categories = ["logs", "configuration", "metrics"] as const;
const labels = {
  logs: "Logs",
  configuration: "Configuration",
  metrics: "Metrics",
};
const field =
  "h-10 min-w-0 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-active-500";
export function DiagnosticSelectionForm({
  selection,
  onSelection,
  preview,
  consent,
  onConsent,
  onPreview,
  onCreate,
  busy,
}: {
  selection: SupportDiagnosticSelection;
  onSelection: (value: SupportDiagnosticSelection) => void;
  preview: SupportDiagnosticPreview | null;
  consent: boolean;
  onConsent: (value: boolean) => void;
  onPreview: () => void;
  onCreate: () => void;
  busy: boolean;
}) {
  return (
    <section
      aria-label="Generate diagnostics"
      className={cn(diagnosticPanel, "flex flex-col gap-5")}
    >
      <h3 className={cn("text-h5")}>Generate diagnostics</h3>
      <fieldset disabled={busy} className={cn("flex flex-wrap gap-6")}>
        <legend className={cn("mb-3 text-subhead-semibold")}>
          Included categories
        </legend>
        {categories.map((category) => (
          <label
            key={category}
            className={cn("flex min-h-10 items-center gap-2")}
          >
            <input
              type="checkbox"
              checked={selection.categories.includes(category)}
              onChange={(event) =>
                onSelection({
                  ...selection,
                  categories: event.target.checked
                    ? [...selection.categories, category]
                    : selection.categories.filter((item) => item !== category),
                })
              }
            />
            {labels[category]}
          </label>
        ))}
      </fieldset>
      <div className={cn("flex flex-wrap items-end gap-4")}>
        <label className={cn("flex min-w-0 flex-col gap-2")}>
          From (UTC)
          <input
            className={cn(field)}
            type="datetime-local"
            disabled={busy}
            value={selection.from.slice(0, 16)}
            onChange={(event) => {
              if (event.target.value)
                onSelection({
                  ...selection,
                  from: `${event.target.value}:00.000Z`,
                });
            }}
          />
        </label>
        <label className={cn("flex min-w-0 flex-col gap-2")}>
          To (UTC)
          <input
            className={cn(field)}
            type="datetime-local"
            disabled={busy}
            value={selection.to.slice(0, 16)}
            onChange={(event) => {
              if (event.target.value)
                onSelection({
                  ...selection,
                  to: `${event.target.value}:00.000Z`,
                });
            }}
          />
        </label>
        <Button
          variant="outline"
          tone="grey"
          disabled={busy}
          onClick={() => onSelection(defaultDiagnosticSelection())}
        >
          Last 24 hours
        </Button>
      </div>
      <p>
        Maximum seven days. Preview lists static fields, redaction examples and
        fixed limits; it does not collect source data. Source permissions are
        checked again during collection. The range filters logs; configuration
        and metrics show their observation timestamps when available.
      </p>
      <div>
        <Button disabled={busy} onClick={onPreview}>
          {busy ? "Working…" : "Preview diagnostic selection"}
        </Button>
      </div>
      {preview ? (
        <section
          aria-label="Diagnostic disclosure"
          className={cn("flex flex-col gap-4 border-t border-border pt-5")}
        >
          <h4 className={cn("text-subhead-semibold")}>
            Review before collection
          </h4>
          <p>
            Fixed maximum: {preview.estimate.maxBytes.toLocaleString()} bytes
            and {preview.estimate.maxLogRows.toLocaleString()} log rows. This is
            an unmeasured upper bound.
          </p>
          {categories
            .filter((category) =>
              preview.selection.categories.includes(category),
            )
            .map((category) => (
              <div key={category}>
                <h5 className={cn("text-subhead-semibold")}>
                  {labels[category]}
                </h5>
                <p className={cn("break-words")}>
                  {preview.fields[category].join(", ")}
                </p>
                <p className={cn("mt-1 break-words")}>
                  Redacted example: {preview.examples[category]}
                </p>
              </div>
            ))}
          <p>
            Preview expires {new Date(preview.expiresAt).toLocaleString()}.
            Bundles are available for 24 hours. Expiry does not remove retained
            storage; cleanup requires a separate review.
          </p>
          <label className={cn("flex min-h-10 items-start gap-3")}>
            <input
              type="checkbox"
              className={cn("mt-1")}
              checked={consent}
              disabled={busy}
              onChange={(event) => onConsent(event.target.checked)}
            />
            <span>
              I consent to collect the selected redacted diagnostics for this
              organization. I will inspect the content before sharing it
              independently.
            </span>
          </label>
          <div>
            <Button disabled={busy || !consent} onClick={onCreate}>
              Create diagnostic bundle
            </Button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
