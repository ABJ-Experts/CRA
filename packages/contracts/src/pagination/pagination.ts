import { pageParamsSchema } from "./schemas/index.js";
import type { PageParams, PageParamsInput, Paged } from "./types/index.js";

export function parsePageParams(input: PageParamsInput): PageParams {
  return pageParamsSchema.parse(input);
}

export function resolvePage(
  total: number,
  params: PageParams,
): { page: number; pageCount: number; from: number; to: number } {
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize));
  const page = Math.min(Math.max(1, params.page), pageCount);
  const from = (page - 1) * params.pageSize;
  return { page, pageCount, from, to: from + params.pageSize - 1 };
}

export function paged<T>(
  rows: T[],
  total: number,
  params: PageParams,
): Paged<T> {
  const { page, pageCount } = resolvePage(total, params);
  return { rows, total, page, pageSize: params.pageSize, pageCount };
}
