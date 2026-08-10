// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { organizationsApi } from "./organizations.api";
import { organizationKeys } from "./organizations.keys";
import {
  ORGANIZATIONS_STALE_TIME_MS,
  organizationCurrentQueryOptions,
  organizationOnboardingQueryOptions,
  useCurrentOrganizationQuery,
  useCreateOrganizationMutation,
  useOnboardingQuery,
  useSwitchOrganizationMutation,
} from "./organizations.queries";

vi.mock("./organizations.api", () => ({
  organizationsApi: {
    create: vi.fn(),
    switch: vi.fn(),
    current: vi.fn(),
    onboarding: vi.fn(),
  },
}));

const CREATE_INPUT = {
  legalName: "Analytical Engines Ltd",
  registeredAddress: {
    addressLine1: "1 Engine Way",
    locality: "London",
    postalCode: "SW1A 1AA",
    country: "GB",
  },
  mainEstablishmentCountry: "GB",
  manufacturerContactName: "Ada Lovelace",
  manufacturerContactEmail: "ada@example.com",
  idempotencyKey: "44444444-4444-4444-8444-444444444444",
} as const;

describe("organization query helpers", () => {
  afterEach(() => vi.clearAllMocks());

  it("publishes stable, frozen organization query keys", () => {
    expect(organizationKeys).toEqual({
      all: ["organizations"],
      current: ["organizations", "current"],
      onboarding: ["organizations", "current", "onboarding"],
    });
    expect(Object.isFrozen(organizationKeys)).toBe(true);
    expect(Object.values(organizationKeys).every(Object.isFrozen)).toBe(true);
  });

  it("keeps server progress queries short-lived and non-retrying", () => {
    expect(organizationCurrentQueryOptions(false)).toMatchObject({
      queryKey: organizationKeys.current,
      enabled: false,
      retry: false,
      staleTime: ORGANIZATIONS_STALE_TIME_MS,
    });
    expect(organizationOnboardingQueryOptions(false)).toMatchObject({
      queryKey: organizationKeys.onboarding,
      enabled: false,
      retry: false,
      staleTime: ORGANIZATIONS_STALE_TIME_MS,
    });
  });

  it("binds both live query hooks to their typed API methods", async () => {
    vi.mocked(organizationsApi.current).mockResolvedValue({
      organization: null,
    });
    vi.mocked(organizationsApi.onboarding).mockResolvedValue({
      organization: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Analytical Engines Ltd",
        slug: "analytical-engines-ltd",
        legalProfile: null,
      },
      stages: [],
      nextIncompleteStage: null,
      blocked: false,
      integrationAvailability: {
        products: false,
        sbom: false,
        invitations: false,
      },
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

    renderHook(
      () => ({
        current: useCurrentOrganizationQuery(true),
        onboarding: useOnboardingQuery(true),
      }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(organizationsApi.current).toHaveBeenCalledOnce();
      expect(organizationsApi.onboarding).toHaveBeenCalledOnce();
    });
  });

  it("invalidates session and organization state after create and switch", async () => {
    vi.mocked(organizationsApi.create).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Analytical Engines Ltd",
      slug: "analytical-engines-ltd",
      legalProfile: null,
    });
    vi.mocked(organizationsApi.switch).mockResolvedValue({
      organization: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Analytical Engines Ltd",
        slug: "analytical-engines-ltd",
        legalProfile: null,
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    let create: ReturnType<typeof useCreateOrganizationMutation> | undefined;
    let switchOrganization:
      ReturnType<typeof useSwitchOrganizationMutation> | undefined;

    function CaptureMutations() {
      create = useCreateOrganizationMutation();
      switchOrganization = useSwitchOrganizationMutation();
      return null;
    }

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    render(<CaptureMutations />, { wrapper: Wrapper });

    await act(async () => {
      await create?.mutateAsync(CREATE_INPUT);
      await switchOrganization?.mutateAsync(
        "11111111-1111-4111-8111-111111111111",
      );
    });

    expect(organizationsApi.create).toHaveBeenCalledWith(CREATE_INPUT);
    expect(organizationsApi.switch).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["session"] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["organizations"],
    });
  });
});
