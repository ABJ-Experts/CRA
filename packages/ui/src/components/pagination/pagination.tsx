"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, type ComponentProps } from "react";
import { cn } from "../../lib/cn";
import { Select, SelectItem } from "../select";

/**
 * Pagination - Pencil frame `SapaF`.
 *
 * Measured, both responsive variants:
 *
 *   root        padding 24 0, gap 4, items centred
 *   left group  gap 8, fills the row so the pager sits hard right
 *   labels      12px Medium -> `caption-1-medium` + `fg-subtle`
 *   rows select 80x40, the Forms/Select Basic component verbatim
 *   item        40x40 (56 for First/End), radius 20 -> `rounded-full`
 *   idle        #f5f5f5 / #26282a -> `surface`,  label `fg-muted`
 *   current     #1b1d1f / #ffffff -> `fg`,       label `canvas`
 *   label       14px Medium -> `subhead-medium`; arrows 16px
 *
 * Mobile drops the numbered pills and the "Rows per page" caption, leaving
 * `[select] [of N] ... [prev] [Page N] [next]`. Both layouts ship in one
 * component and swap at the `sm` breakpoint in CSS, so nothing depends on
 * measuring the viewport in JS (which would flash the wrong layout on first
 * paint).
 *
 * ```tsx
 * <Pagination page={page} pageCount={12} onPageChange={setPage} />
 * ```
 */

/** A page number, or a gap where pages were elided. */
type PageItem = number | "start-ellipsis" | "end-ellipsis";

const range = (start: number, end: number): number[] =>
  end < start ? [] : Array.from({ length: end - start + 1 }, (_, i) => start + i);

/**
 * Standard boundary/sibling windowing.
 *
 * The frame illustrates one arrangement (`01 02 03 04 05 ... 11 12` at page
 * one). That is a drawing of a single input, not a rule - no fixed pair of
 * boundary/sibling counts reproduces it AND stays sensible as the page moves.
 * So the algorithm is the conventional one and the defaults are chosen to
 * match the frame's shape: two pages pinned at each end, one either side of
 * the current page.
 */
function usePageItems(
  page: number,
  pageCount: number,
  siblingCount: number,
  boundaryCount: number
): PageItem[] {
  return useMemo(() => {
    const startPages = range(1, Math.min(boundaryCount, pageCount));
    const endPages = range(
      Math.max(pageCount - boundaryCount + 1, boundaryCount + 1),
      pageCount
    );

    const siblingsStart = Math.max(
      Math.min(page - siblingCount, pageCount - boundaryCount - siblingCount * 2 - 1),
      boundaryCount + 2
    );
    const siblingsEnd = Math.min(
      Math.max(page + siblingCount, boundaryCount + siblingCount * 2 + 2),
      endPages.length > 0 ? (endPages[0] as number) - 2 : pageCount - 1
    );

    return [
      ...startPages,
      ...(siblingsStart > boundaryCount + 2
        ? ["start-ellipsis" as const]
        : boundaryCount + 1 < pageCount - boundaryCount
          ? [boundaryCount + 1]
          : []),
      ...range(siblingsStart, siblingsEnd),
      ...(siblingsEnd < pageCount - boundaryCount - 1
        ? ["end-ellipsis" as const]
        : pageCount - boundaryCount > boundaryCount
          ? [pageCount - boundaryCount]
          : []),
      ...endPages,
    ];
  }, [page, pageCount, siblingCount, boundaryCount]);
}

export interface PaginationProps extends Omit<ComponentProps<"nav">, "onChange"> {
  /** Current page, 1-based. Clamped into range. */
  page: number;
  /** Total number of pages. Values below 1 render nothing. */
  pageCount: number;
  onPageChange: (page: number) => void;

  /** Pages either side of the current one. */
  siblingCount?: number;
  /** Pages pinned at each end. */
  boundaryCount?: number;

  /** Show the First / End pills. */
  showFirstLast?: boolean;

  /** Rows-per-page select. Omit `onPageSizeChange` to hide the control. */
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;

  /** Total row count, used for the "1-15 of 209" caption. */
  total?: number;

  label?: string;
  labels?: Partial<{
    rowsPerPage: string;
    first: string;
    previous: string;
    next: string;
    last: string;
    page: string;
  }>;
}

const itemBase = [
  "inline-flex h-10 shrink-0 items-center justify-center rounded-full",
  "text-subhead-medium",
  "transition-colors duration-150 motion-reduce:transition-none",
  "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
].join(" ");

export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  boundaryCount = 2,
  showFirstLast = true,
  pageSize,
  pageSizeOptions = [15, 25, 50, 100],
  onPageSizeChange,
  total,
  label = "Pagination",
  labels,
  className,
  ...props
}: PaginationProps) {
  const t = {
    rowsPerPage: "Rows per page",
    first: "First",
    previous: "Previous page",
    next: "Next page",
    last: "End",
    page: "Page",
    ...labels,
  };

  // Never trust the caller's page: an out-of-range value would otherwise
  // highlight nothing and leave both arrows enabled.
  const safeCount = Math.max(0, Math.floor(pageCount));
  const current = Math.min(Math.max(1, Math.floor(page)), Math.max(1, safeCount));

  const items = usePageItems(current, safeCount, siblingCount, boundaryCount);

  if (safeCount < 1) return null;

  const atStart = current <= 1;
  const atEnd = current >= safeCount;

  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), safeCount);
    if (clamped !== current) onPageChange(clamped);
  };

  // "1-15 of 209" when the page size is known, "of 209" otherwise, matching
  // the desktop and mobile captions respectively.
  const rangeLabel =
    total !== undefined && pageSize
      ? `${Math.min((current - 1) * pageSize + 1, total)}-${Math.min(current * pageSize, total)} of ${total}`
      : total !== undefined
        ? `of ${total}`
        : null;

  const arrow = (dir: "prev" | "next") => (
    <button
      type="button"
      aria-label={dir === "prev" ? t.previous : t.next}
      disabled={dir === "prev" ? atStart : atEnd}
      onClick={() => go(dir === "prev" ? current - 1 : current + 1)}
      className={cn(
        itemBase,
        "w-10 bg-surface text-fg-muted",
        "hover:bg-surface-muted hover:text-fg",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-fg-muted"
      )}
    >
      {dir === "prev" ? (
        <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={1.5} />
      ) : (
        <ChevronRight aria-hidden="true" className="size-4" strokeWidth={1.5} />
      )}
    </button>
  );

  return (
    <nav
      aria-label={label}
      className={cn("flex w-full items-center gap-1 py-6", className)}
      {...props}
    >
      {/* Left group: rows-per-page and the range caption. */}
      <div className="flex flex-1 items-center gap-2">
        {onPageSizeChange && pageSize !== undefined ? (
          <>
            <span className="hidden text-caption-1-medium text-fg-subtle sm:inline">
              {t.rowsPerPage}
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
              aria-label={t.rowsPerPage}
              wrapperClassName="w-20"
              data-testid="pagination-page-size"
            >
              {pageSizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </Select>
          </>
        ) : null}
        {rangeLabel ? (
          <span
            className="text-caption-1-medium text-fg-subtle"
            data-testid="pagination-range"
          >
            {rangeLabel}
          </span>
        ) : null}
      </div>

      {/* Desktop pager: numbered pills. */}
      <ul className="hidden items-center gap-1 sm:flex" data-testid="pagination-pages">
        {showFirstLast ? (
          <li>
            <button
              type="button"
              disabled={atStart}
              onClick={() => go(1)}
              className={cn(
                itemBase,
                "w-14 bg-surface text-fg-muted",
                "hover:bg-surface-muted hover:text-fg",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-fg-muted"
              )}
            >
              {t.first}
            </button>
          </li>
        ) : null}

        <li>{arrow("prev")}</li>

        {items.map((item, i) =>
          typeof item === "number" ? (
            <li key={item}>
              <button
                type="button"
                aria-current={item === current ? "page" : undefined}
                aria-label={`${t.page} ${item}`}
                onClick={() => go(item)}
                className={cn(
                  itemBase,
                  "w-10",
                  item === current
                    ? "bg-fg text-canvas"
                    : "bg-surface text-fg-muted hover:bg-surface-muted hover:text-fg"
                )}
              >
                {/* The frame zero-pads to two digits; beyond 99 it just grows. */}
                {String(item).padStart(2, "0")}
              </button>
            </li>
          ) : (
            // A pill in the design, not a control: it carries no action, so it
            // is not a button and is hidden from assistive tech.
            <li key={`${item}-${i}`} aria-hidden="true">
              <span className={cn(itemBase, "w-10 bg-surface text-fg-muted")}>...</span>
            </li>
          )
        )}

        <li>{arrow("next")}</li>

        {showFirstLast ? (
          <li>
            <button
              type="button"
              disabled={atEnd}
              onClick={() => go(safeCount)}
              className={cn(
                itemBase,
                "w-14 bg-surface text-fg-muted",
                "hover:bg-surface-muted hover:text-fg",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-fg-muted"
              )}
            >
              {t.last}
            </button>
          </li>
        ) : null}
      </ul>

      {/* Mobile pager: prev / "Page N" / next. */}
      <div className="flex items-center gap-1 sm:hidden" data-testid="pagination-mobile">
        {arrow("prev")}
        <span
          className="px-2 text-subhead-regular text-fg"
          aria-current="page"
          data-testid="pagination-mobile-label"
        >
          {t.page} {current}
        </span>
        {arrow("next")}
      </div>
    </nav>
  );
}
