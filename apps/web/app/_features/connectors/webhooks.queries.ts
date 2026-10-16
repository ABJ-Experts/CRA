"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../_providers/session-provider";
import { productsApi } from "../products/products.api";
import { webhooksApi } from "./webhooks.api";

export function webhookKey(
  organizationId: string,
  ...parts: readonly unknown[]
) {
  return ["connectors", organizationId, "webhooks", ...parts] as const;
}
export function useWebhookQueries(
  endpointId: string,
  deliveryId: string,
  endpointPage: number,
  deliveryPage: number,
  attemptPage: number,
  enabled: boolean,
  productPage: number,
) {
  const { session } = useSession();
  const organizationId = session?.organization?.id ?? "no-organization";
  const allowed = enabled && organizationId !== "no-organization";
  const endpoints = useQuery({
    queryKey: webhookKey(organizationId, "endpoints", endpointPage),
    enabled: allowed,
    retry: false,
    queryFn: ({ signal }) =>
      webhooksApi.list({ page: endpointPage, pageSize: 15 }, signal),
  });
  const endpoint = useQuery({
    queryKey: webhookKey(organizationId, "endpoint", endpointId),
    enabled: allowed && Boolean(endpointId),
    retry: false,
    queryFn: ({ signal }) => webhooksApi.get(endpointId, signal),
  });
  const catalogue = useQuery({
    queryKey: webhookKey(organizationId, "catalogue"),
    enabled: allowed,
    retry: false,
    queryFn: ({ signal }) => webhooksApi.catalogue(signal),
  });
  const products = useQuery({
    queryKey: webhookKey(organizationId, "products", productPage),
    enabled: allowed,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.list({ page: productPage, pageSize: 25 }, signal),
  });
  const deliveries = useQuery<
    Awaited<ReturnType<typeof webhooksApi.deliveries>>
  >({
    queryKey: webhookKey(
      organizationId,
      endpointId,
      "deliveries",
      deliveryPage,
    ),
    enabled: allowed && Boolean(endpointId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.deliveries.rows.some((delivery) =>
        ["pending", "delivering", "retrying"].includes(delivery.status),
      )
        ? 3_000
        : false,
    queryFn: ({ signal }) =>
      webhooksApi.deliveries(
        endpointId,
        { page: deliveryPage, pageSize: 15 },
        signal,
      ),
  });
  const detail = useQuery({
    queryKey: webhookKey(
      organizationId,
      endpointId,
      deliveryId,
      "detail",
      attemptPage,
    ),
    enabled: allowed && Boolean(endpointId) && Boolean(deliveryId),
    retry: false,
    queryFn: ({ signal }) =>
      webhooksApi.detail(
        endpointId,
        deliveryId,
        { page: attemptPage, pageSize: 15 },
        signal,
      ),
  });
  return { endpoints, endpoint, catalogue, products, deliveries, detail };
}
/** Commands bypass MutationCache: credentials never remain in completed mutation variables. */
export function useWebhookCommand() {
  const { session } = useSession();
  const organizationId = session?.organization?.id;
  const active = useRef(organizationId);
  active.current = organizationId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  return {
    pending,
    async run<T>(action: () => Promise<T>): Promise<T> {
      if (
        !organizationId ||
        active.current !== organizationId ||
        !mounted.current
      )
        throw new Error(
          "Organization changed. Reopen webhooks in the selected workspace.",
        );
      if (inFlight.current)
        throw new Error("Wait for the current webhook action to finish.");
      inFlight.current = true;
      setPending(true);
      try {
        const result = await action();
        if (active.current !== organizationId || !mounted.current)
          throw new Error(
            "Organization changed during the action. Reload current data.",
          );
        await client.invalidateQueries({
          queryKey: webhookKey(organizationId),
        });
        if (active.current !== organizationId || !mounted.current)
          throw new Error(
            "Organization changed during the action. Reload current data.",
          );
        return result;
      } finally {
        inFlight.current = false;
        if (mounted.current) setPending(false);
      }
    },
  };
}
