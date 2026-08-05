import type { ReactNode } from "react";

/**
 * Severity donut plus the per-severity table beside it.
 *
 * Drawn as an SVG rather than pulled through a charting library: it is five
 * numbers and a ring, and a chart dependency would cost more than it explains.
 *
 * FR-FE-008 forbids colour-only signalling, so every severity carries its
 * written name next to the dot and the counts are readable without seeing the
 * ring at all.
 */

export interface SeverityCount {
  key: string;
  label: string;
  dot: string;
  count: number;
}

/* Stroke colours are literal rather than token classes because SVG `stroke`
 * cannot read a Tailwind background utility. They track the same palette. */
const STROKE: Record<string, string> = {
  critical: "var(--color-danger-500, #ef4444)",
  high: "var(--color-warning-500, #f97316)",
  medium: "var(--color-warning-400, #f59e0b)",
  low: "var(--color-info-500, #3b82f6)",
  unknown: "var(--color-fg-subtle, #94a3b8)",
};

const R = 54;
const CIRC = 2 * Math.PI * R;

export function SeverityBreakdown({
  counts,
  open,
}: {
  counts: SeverityCount[];
  open: number;
}): ReactNode {
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-8 sm:flex-row sm:gap-10">
      <div className="relative shrink-0">
        <svg
          width="150"
          height="150"
          viewBox="0 0 150 150"
          role="img"
          aria-label={`${open} open findings`}
        >
          <circle
            cx="75"
            cy="75"
            r={R}
            fill="none"
            strokeWidth="16"
            className="stroke-surface"
          />
          {open > 0 &&
            counts
              .filter((s) => s.count > 0)
              .map((s) => {
                const len = (s.count / open) * CIRC;
                const dash = `${len} ${CIRC - len}`;
                /* -90deg so the first arc starts at 12 o'clock. */
                const el = (
                  <circle
                    key={s.key}
                    cx="75"
                    cy="75"
                    r={R}
                    fill="none"
                    strokeWidth="16"
                    stroke={STROKE[s.key]}
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 75 75)"
                  />
                );
                offset += len;
                return el;
              })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-h4 text-fg">{open}</span>
          <span className="text-caption-2-semibold uppercase tracking-wide text-fg-muted">
            Open
          </span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 self-stretch">
        {counts.map((s) => (
          <li
            key={s.key}
            className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className={`size-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
              <span className="truncate text-caption-1-regular text-fg">{s.label}</span>
            </span>
            <span className="shrink-0 text-caption-1-semibold text-fg">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
