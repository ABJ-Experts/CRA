"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditSiemGateway } from "./siem.api";
/** Command closures live only for their awaited invocation; credentials never enter a mutation cache. */
export function useSiemCommand() {
  const active = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (active.current) {
      setPending(true);
      setError(null);
    }
    try {
      return await operation();
    } catch {
      if (active.current)
        setError(
          "SIEM action failed. Check permissions and current status, then retry.",
        );
      return undefined;
    } finally {
      if (active.current) setPending(false);
    }
  }
  return { pending, error, run };
}
export function useSiemQueries(
  orgId: string,
  selectedId: string,
  cursor: string | undefined,
  enabled: boolean,
) {
  const list = useQuery({
    queryKey: ["audit", orgId, "siem", "destinations"],
    enabled,
    retry: false,
    queryFn: ({ signal }) => auditSiemGateway.list(crypto.randomUUID(), signal),
    refetchInterval: 10000,
  });
  const catalogue = useQuery({
    queryKey: ["audit", orgId, "siem", "catalogue"],
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      auditSiemGateway.catalogue(crypto.randomUUID(), signal),
  });
  const deliveries = useQuery({
    queryKey: ["audit", orgId, "siem", selectedId, "deliveries", cursor],
    enabled: enabled && Boolean(selectedId),
    retry: false,
    queryFn: ({ signal }) =>
      auditSiemGateway.deliveries(
        selectedId,
        { requestId: crypto.randomUUID(), limit: 50, cursor },
        signal,
      ),
    refetchInterval: 10000,
  });
  return { list, catalogue, deliveries };
}
