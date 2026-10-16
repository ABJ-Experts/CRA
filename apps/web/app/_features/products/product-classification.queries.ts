"use client";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../_providers/session-provider";
import { productClassificationApi } from "./product-classification.api";
export function useProductClassificationHistory(
  productId: string,
  page: number,
) {
  const { session, permissions } = useSession();
  const org = session?.organization?.id;
  return useQuery({
    queryKey: [
      "products",
      "classification-history",
      org ?? null,
      productId,
      page,
    ],
    enabled: Boolean(org) && permissions.can_view_products === true,
    retry: false,
    queryFn: ({ signal }) =>
      productClassificationApi.history(
        productId,
        { page, pageSize: 15 },
        signal,
      ),
  });
}
export function useProductClassifications(
  productIds: readonly string[],
  enabled: boolean,
) {
  const { session, permissions } = useSession();
  const org = session?.organization?.id;
  return useQuery({
    queryKey: ["products", "classifications", org ?? null, productIds],
    enabled:
      enabled &&
      Boolean(org) &&
      permissions.can_view_products === true &&
      productIds.length > 0,
    retry: false,
    queryFn: ({ signal }) =>
      productClassificationApi.latest(productIds, signal),
  });
}
