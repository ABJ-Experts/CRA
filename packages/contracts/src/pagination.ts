/**
 * The list-response contract.
 *
 * This shape is already fixed by two existing consumers that must not change:
 * `apps/web/mocks/handlers.ts` returns it, and
 * `apps/web/app/dashboard/_lib/use-table-query.ts` plus `@repo/ui/data-table`
 * read it. Every real list endpoint returns exactly this, bare — there is no
 * success envelope anywhere in the API, precisely so that swapping a table from
 * MSW to the real API is a URL change and nothing else.
 */

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export const DEFAULT_PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page: number;
  pageSize: number;
  sort?: string;
  order: "asc" | "desc";
  q?: string;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** Normalize raw query input into safe bounds. */
export function parsePageParams(input: {
  page?: unknown;
  pageSize?: unknown;
  sort?: unknown;
  order?: unknown;
  q?: unknown;
}): PageParams {
  const pageSize = Math.min(
    toPositiveInt(input.pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const q =
    typeof input.q === "string" && input.q.trim() !== ""
      ? input.q.trim()
      : undefined;
  return {
    page: toPositiveInt(input.page, 1),
    pageSize,
    sort:
      typeof input.sort === "string" && input.sort !== ""
        ? input.sort
        : undefined,
    order: input.order === "desc" ? "desc" : "asc",
    q,
  };
}

/**
 * Build the envelope from a total and the requested page.
 *
 * Clamps an out-of-range page down to the last real page rather than returning
 * an empty result — `mocks/handlers.ts` already does this, and the two must
 * agree or filtering while on a late page strands the table blank on the real
 * API but not on the mock. Returns the clamped page so the caller can use it
 * for the actual range query.
 */
export function resolvePage(
  total: number,
  params: PageParams,
): {
  page: number;
  pageCount: number;
  from: number;
  to: number;
} {
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize));
  const page = Math.min(Math.max(1, params.page), pageCount);
  const from = (page - 1) * params.pageSize;
  // Inclusive upper bound, matching PostgREST's `.range(from, to)`.
  const to = from + params.pageSize - 1;
  return { page, pageCount, from, to };
}

export function paged<T>(
  rows: T[],
  total: number,
  params: PageParams,
): Paged<T> {
  const { page, pageCount } = resolvePage(total, params);
  return { rows, total, page, pageSize: params.pageSize, pageCount };
}
