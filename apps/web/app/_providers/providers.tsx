"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * App-wide client providers: TanStack Query, plus the MSW readiness gate.
 *
 * THE GATE IS THE POINT. MSW intercepts through a service worker, and a
 * worker only starts intercepting once it has registered and activated. Any
 * query that fires before that goes to the network and 404s, so the first
 * paint after a hard reload would show an error state that fixes itself on
 * the next navigation. That is the classic MSW-in-an-app bug.
 *
 * So `worker.start()` is awaited and the result published through context.
 * Screens read `useMocksReady()` and pass it to `enabled`, which means no
 * query can be issued too early. Nothing is blocked from RENDERING: the
 * layout and skeletons paint immediately, only fetching waits.
 */

const MocksReadyContext = createContext(false);

/** True once the API is answerable. Pass to a query's `enabled`. */
export function useMocksReady() {
  return useContext(MocksReadyContext);
}

const MOCKS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MOCKS !== "false";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /* Long enough that moving between dashboards does not refetch
         * everything, short enough that the data still feels live. */
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  /* On the server every request needs its own client, or two users would
   * share a cache. In the browser the client must survive re-renders, so it
   * is created once and reused. */
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getQueryClient);
  const [mocksReady, setMocksReady] = useState(!MOCKS_ENABLED);

  useEffect(() => {
    if (!MOCKS_ENABLED) return;
    let cancelled = false;

    (async () => {
      try {
        const { worker } = await import("../../mocks/browser");
        await worker.start({
          onUnhandledRequest: "bypass",
          quiet: true,
          serviceWorker: { url: "/mockServiceWorker.js" },
        });
      } catch {
        /* If the worker cannot start (unsupported context, blocked scope) the
         * app must not hang on a spinner forever. Opening the gate lets the
         * queries run and fail visibly, which is a diagnosable state. */
      } finally {
        if (!cancelled) setMocksReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <MocksReadyContext.Provider value={mocksReady}>{children}</MocksReadyContext.Provider>
    </QueryClientProvider>
  );
}
