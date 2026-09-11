// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { organizationsApi } from "./organizations.api";
import {
  activeOrganizationBrandingQueryOptions,
  useActiveOrganizationBrandingQuery,
} from "./active-organization-branding.queries";

vi.mock("./organizations.api", () => ({
  organizationsApi: { branding: vi.fn() },
}));

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("active organization branding query", () => {
  afterEach(() => vi.clearAllMocks());

  it("partitions the server-owned branding snapshot by active organization", () => {
    expect(
      activeOrganizationBrandingQueryOptions(organizationId, true),
    ).toMatchObject({
      queryKey: ["organizations", "current", "branding", organizationId],
      enabled: true,
      retry: false,
      staleTime: 30_000,
    });
    expect(activeOrganizationBrandingQueryOptions(null, true)).toMatchObject({
      queryKey: ["organizations", "current", "branding", "none"],
      enabled: false,
    });
  });

  it("requests the resolved snapshot without sending the cache partition", async () => {
    vi.mocked(organizationsApi.branding).mockResolvedValue({
      branding: null,
    } as never);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    renderHook(() => useActiveOrganizationBrandingQuery(organizationId, true), {
      wrapper: Wrapper,
    });

    await waitFor(() =>
      expect(organizationsApi.branding).toHaveBeenCalledOnce(),
    );
    expect(organizationsApi.branding).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    );
  });
});
