"use client";

import { cn } from "@repo/ui/cn";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Search and filter bar above every Tables screen.
 *
 * Pencil `r634L`: 1110x88, a 350x40 pill search field filled `surface` with
 * radius 24, and a 410x40 action group on the right.
 *
 * The input is DEBOUNCED and locally controlled. Typing straight into the
 * query state would fire a request per keystroke and, because searching
 * resets to page one, would also thrash the pager. 300ms is long enough to
 * coalesce a word and short enough to feel immediate.
 */

export interface TableToolbarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Rendered in the right-hand action group. */
  actions?: ReactNode;
  resultCount?: number;
  className?: string;
}

export function TableToolbar({
  value,
  onChange,
  placeholder = "Search",
  actions,
  resultCount,
  className,
}: TableToolbarProps) {
  const [draft, setDraft] = useState(value);

  /* Keep the field in step when the query is cleared from outside. */
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const id = setTimeout(() => onChange(draft), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4 py-6", className)}>
      <div
        className={cn(
          "flex h-10 w-full max-w-[350px] items-center gap-2 rounded-3xl bg-surface px-4",
          "transition-shadow focus-within:ring-2 focus-within:ring-active-500"
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-subhead-regular text-fg outline-none",
            "placeholder:text-fg-subtle",
            /* Safari draws its own clear button on search inputs, which sits
             * badly against the custom one below. */
            "[&::-webkit-search-cancel-button]:appearance-none"
          )}
        />
        {draft ? (
          <button
            type="button"
            onClick={() => setDraft("")}
            aria-label="Clear search"
            className="shrink-0 rounded-full p-0.5 text-fg-subtle transition-colors hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        {resultCount != null && value ? (
          <span aria-live="polite" className="text-caption-1-regular text-fg-muted">
            {resultCount} {resultCount === 1 ? "result" : "results"}
          </span>
        ) : null}
        {actions ?? (
          <button
            type="button"
            className={cn(
              "flex h-10 items-center gap-2 rounded-xl border border-border px-4",
              "text-caption-1-semibold text-fg-muted transition-colors",
              "hover:bg-surface hover:text-fg",
              "outline-none focus-visible:ring-2 focus-visible:ring-active-500"
            )}
          >
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Filters
          </button>
        )}
      </div>
    </div>
  );
}
