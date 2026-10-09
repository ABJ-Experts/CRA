"use client";

import type { FindingImpactSummaryQuery } from "@repo/contracts/findings";
import { useQuery } from "@tanstack/react-query";

import { findingImpactApi } from "./finding-impact.api";
import { findingImpactKeys } from "./finding-impact.keys";

export function useFindingImpactSummaryQuery(
  productId: string,
  query: FindingImpactSummaryQuery = {},
  enabled: boolean,
) {
  return useQuery({
    queryKey: findingImpactKeys.productSummary(productId, query.releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      findingImpactApi.getProductSummary(productId, query, signal),
  });
}
