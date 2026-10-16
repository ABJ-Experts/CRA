"use client";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../_providers/session-provider";
import { productsApi } from "./products.api";
export function useProductOwnerOptionsQuery(
  page: number,
  selectedOwnerId: string,
  productId?: string,
) {
  const organizationId = useSession().session?.organization?.id;
  return useQuery({
    enabled: Boolean(organizationId),
    queryKey: [
      "products",
      "owner-options",
      organizationId ?? null,
      page,
      selectedOwnerId,
      productId ?? null,
    ],
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.ownerOptions(
        {
          page,
          pageSize: 25,
          ...(productId
            ? { productId }
            : selectedOwnerId
              ? { selectedOwnerId }
              : {}),
        },
        signal,
      ),
  });
}
