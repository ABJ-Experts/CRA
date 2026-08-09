import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 100;

export const pagedSchema = <T>(rowSchema: z.ZodType<T>) =>
  z
    .object({
      rows: z.array(rowSchema),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
      pageCount: z.number().int().positive(),
    })
    .strict();

function toPositiveInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** Parses raw URL query values into the normalized values used by repositories. */
export const pageParamsSchema = z
  .object({
    page: z.unknown().optional(),
    pageSize: z.unknown().optional(),
    sort: z.unknown().optional(),
    order: z.unknown().optional(),
    q: z.unknown().optional(),
  })
  .transform((input) => {
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
      ...(typeof input.sort === "string" && input.sort !== ""
        ? { sort: input.sort }
        : {}),
      order: input.order === "desc" ? ("desc" as const) : ("asc" as const),
      ...(q === undefined ? {} : { q }),
    };
  });
