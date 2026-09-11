// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { organizationsApi } from "./organizations.api";
import { organizationKeys } from "./organizations.keys";
import {
  ORGANIZATIONS_STALE_TIME_MS,
  organizationBrandingPreviewQueryOptions,
  organizationBrandingQueryOptions,
  organizationCurrentQueryOptions,
  organizationExportQueryOptions,
  organizationLegalEntitiesQueryOptions,
  latestOrganizationExportQueryOptions,
  useBrandingLogoUploadMutation,
  organizationOnboardingQueryOptions,
  useBrandingPublishMutation,
  useCurrentOrganizationQuery,
  useCreateOrganizationMutation,
  useCreateLegalEntityMutation,
  useLegalEntitiesQuery,
  useOnboardingQuery,
  useLatestOrganizationExportQuery,
  useOrganizationBrandingQuery,
  useOrganizationBrandingPreviewQuery,
  useSwitchOrganizationMutation,
  useUpdateBrandingDraftMutation,
} from "./organizations.queries";

vi.mock("./organizations.api", () => ({
  organizationsApi: {
    create: vi.fn(),
    switch: vi.fn(),
    current: vi.fn(),
    onboarding: vi.fn(),
    exportStatus: vi.fn(),
    latestExport: vi.fn(),
    downloadExport: vi.fn(),
    legalEntities: vi.fn(),
    createLegalEntity: vi.fn(),
    updateLegalEntity: vi.fn(),
    branding: vi.fn(),
    previewBranding: vi.fn(),
    updateBrandingDraft: vi.fn(),
    uploadBrandingLogo: vi.fn(),
    publishBranding: vi.fn(),
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
      settings: ["organizations", "current", "settings"],
      settingsCatalog: ["organizations", "current", "settings", "catalog"],
      retention: ["organizations", "current", "retention"],
      lifecycle: ["organizations", "current", "lifecycle"],
      legalEntities: ["organizations", "current", "legal-entities"],
      branding: ["organizations", "current", "branding"],
      brandingPreview: ["organizations", "current", "branding", "preview"],
      exports: ["organizations", "current", "exports"],
      latestExport: ["organizations", "current", "exports", "latest"],
      exportStatus: expect.any(Function),
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
    expect(organizationLegalEntitiesQueryOptions(false)).toMatchObject({
      queryKey: organizationKeys.legalEntities,
      enabled: false,
      retry: false,
      staleTime: ORGANIZATIONS_STALE_TIME_MS,
    });
    expect(organizationBrandingQueryOptions(false)).toMatchObject({
      queryKey: organizationKeys.branding,
      enabled: false,
      retry: false,
      staleTime: ORGANIZATIONS_STALE_TIME_MS,
    });
    expect(organizationBrandingPreviewQueryOptions(false)).toMatchObject({
      queryKey: organizationKeys.brandingPreview,
      enabled: false,
      retry: false,
      staleTime: ORGANIZATIONS_STALE_TIME_MS,
    });
  });

  it("polls only queued or running server export state and stops at terminal state", () => {
    const options = organizationExportQueryOptions(
      "11111111-1111-4111-8111-111111111111",
      true,
    );
    const refetchInterval = options.refetchInterval as (query: unknown) =>
      number | false;
    const exportState = (status: "queued" | "running" | "completed" | "failed" | "expired") =>
      ({
        state: {
          data: {
            export: {
              status,
            },
          },
        },
      });

    expect(refetchInterval(exportState("queued"))).toBe(5_000);
    expect(refetchInterval(exportState("running"))).toBe(5_000);
    expect(refetchInterval(exportState("completed"))).toBe(false);
    expect(refetchInterval(exportState("failed"))).toBe(false);
    expect(refetchInterval(exportState("expired"))).toBe(false);
    expect(organizationExportQueryOptions(null, true)).toMatchObject({
      enabled: false,
      queryKey: organizationKeys.exports,
    });
  });

  it("uses a server-owned latest export query instead of browser persistence", () => {
    expect(latestOrganizationExportQueryOptions(true)).toMatchObject({
      queryKey: organizationKeys.latestExport,
      enabled: true,
      retry: false,
      staleTime: 0,
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
    vi.mocked(organizationsApi.latestExport).mockResolvedValue({ export: null });
    vi.mocked(organizationsApi.legalEntities).mockResolvedValue({
      legalEntities: [],
    });
    vi.mocked(organizationsApi.branding).mockResolvedValue({
      branding: {
        source: "sentinel",
        displayName: "CRA Sentinel",
        footerText: "CRA Sentinel",
        contactText: null,
        palette: {
          primary: "#0167FF",
          primaryText: "#FFFFFF",
          secondary: "#00A39B",
          secondaryText: "#000000",
        },
        logo: null,
        version: 0,
        publishedAt: null,
        updatedAt: "1970-01-01T00:00:00.000Z",
      },
    });
    vi.mocked(organizationsApi.previewBranding).mockResolvedValue({
      branding: {
        source: "draft_preview",
        displayName: "CRA Sentinel draft",
        footerText: "CRA Sentinel",
        contactText: null,
        palette: {
          primary: "#0167FF",
          primaryText: "#FFFFFF",
          secondary: "#00A39B",
          secondaryText: "#000000",
        },
        logo: null,
        version: 1,
        publishedAt: null,
        updatedAt: "2026-08-10T10:00:00.000Z",
      },
    });
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
        latestExport: useLatestOrganizationExportQuery(true),
        legalEntities: useLegalEntitiesQuery(true),
        branding: useOrganizationBrandingQuery(true),
        brandingPreview: useOrganizationBrandingPreviewQuery(true),
      }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(organizationsApi.current).toHaveBeenCalledOnce();
      expect(organizationsApi.onboarding).toHaveBeenCalledOnce();
      expect(organizationsApi.latestExport).toHaveBeenCalledOnce();
      expect(organizationsApi.legalEntities).toHaveBeenCalledOnce();
      expect(organizationsApi.branding).toHaveBeenCalledOnce();
      expect(organizationsApi.previewBranding).toHaveBeenCalledOnce();
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

  it("invalidates V2 organization state after entity and branding mutations", async () => {
    const brandingResponse = {
      branding: {
        source: "published",
        displayName: "Analytical Engines",
        footerText: "Published footer",
        contactText: null,
        palette: {
          primary: "#000000",
          primaryText: "#FFFFFF",
          secondary: "#FFFFFF",
          secondaryText: "#000000",
        },
        logo: null,
        version: 2,
        publishedAt: "2026-08-10T10:00:00.000Z",
        updatedAt: "2026-08-10T10:00:00.000Z",
      },
    } as const;
    const brandingDraftResponse = {
      draft: {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        displayName: "Analytical Engines",
        footerText: "Draft footer",
        contactText: null,
        palette: { primary: "#000000", secondary: "#FFFFFF" },
        logoAsset: { status: "none", asset: null },
        version: 2,
        createdAt: "2026-08-10T10:00:00.000Z",
        updatedAt: "2026-08-10T10:00:00.000Z",
        createdBy: "33333333-3333-4333-8333-333333333333",
        updatedBy: "33333333-3333-4333-8333-333333333333",
      },
    } as const;
    vi.mocked(organizationsApi.createLegalEntity).mockResolvedValue({
      legalEntity: {
        id: "99999999-9999-4999-8999-999999999999",
        organizationId: "11111111-1111-4111-8111-111111111111",
        identifier: "analytical-engines-gb",
        displayName: "Analytical Engines UK",
        legalName: "Analytical Engines Ltd",
        registeredAddress: CREATE_INPUT.registeredAddress,
        mainEstablishmentCountry: "GB",
        phone: null,
        registrationIdentifier: null,
        taxIdentifier: null,
        manufacturerContactName: "Ada Lovelace",
        manufacturerContactEmail: "ada@example.com",
        status: "active",
        completionStatus: "complete",
        isDefault: true,
        version: 1,
        dependencyProjections: [],
        createdAt: "2026-08-10T10:00:00.000Z",
        updatedAt: "2026-08-10T10:00:00.000Z",
        createdBy: "33333333-3333-4333-8333-333333333333",
        updatedBy: "33333333-3333-4333-8333-333333333333",
        deletedAt: null,
      },
    } as never);
    vi.mocked(organizationsApi.updateBrandingDraft).mockResolvedValue(
      brandingDraftResponse,
    );
    vi.mocked(organizationsApi.uploadBrandingLogo).mockResolvedValue(
      brandingDraftResponse,
    );
    vi.mocked(organizationsApi.publishBranding).mockResolvedValue(
      brandingResponse,
    );
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    let createLegalEntity:
      ReturnType<typeof useCreateLegalEntityMutation> | undefined;
    let updateBranding:
      ReturnType<typeof useUpdateBrandingDraftMutation> | undefined;
    let uploadLogo:
      ReturnType<typeof useBrandingLogoUploadMutation> | undefined;
    let publishBranding:
      ReturnType<typeof useBrandingPublishMutation> | undefined;

    function CaptureMutations() {
      createLegalEntity = useCreateLegalEntityMutation();
      updateBranding = useUpdateBrandingDraftMutation();
      uploadLogo = useBrandingLogoUploadMutation();
      publishBranding = useBrandingPublishMutation();
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
      await createLegalEntity?.mutateAsync({
        identifier: "analytical-engines-gb",
        displayName: "Analytical Engines UK",
        legalName: "Analytical Engines Ltd",
        registeredAddress: CREATE_INPUT.registeredAddress,
        mainEstablishmentCountry: "GB",
        manufacturerContactName: "Ada Lovelace",
        manufacturerContactEmail: "ada@example.com",
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
      });
      await updateBranding?.mutateAsync({
        expectedVersion: 2,
        displayName: "Analytical Engines",
        palette: { primary: "#000000", secondary: "#FFFFFF" },
        footerText: "Draft footer",
        contactText: null,
        logoAssetId: null,
      });
      await uploadLogo?.mutateAsync({
        fields: { altText: "AE logo" },
        file: new File(["png"], "logo.png", { type: "image/png" }),
      });
      await publishBranding?.mutateAsync({
        expectedVersion: 2,
        idempotencyKey: "88888888-8888-4888-8888-888888888888",
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: organizationKeys.legalEntities,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: organizationKeys.branding,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: organizationKeys.brandingPreview,
    });
  });
});
