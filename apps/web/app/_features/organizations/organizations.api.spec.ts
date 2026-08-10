import { afterEach, describe, expect, it, vi } from "vitest";

import { organizationsApi } from "./organizations.api";

const ORGANIZATION = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Analytical Engines Ltd",
  slug: "analytical-engines-ltd",
  legalProfile: {
    id: "22222222-2222-4222-8222-222222222222",
    legalName: "Analytical Engines Ltd",
    registeredAddress: {
      addressLine1: "1 Engine Way",
      locality: "London",
      postalCode: "SW1A 1AA",
      country: "GB",
    },
    mainEstablishmentCountry: "GB",
    phone: "+442079460000",
    manufacturerContactName: "Ada Lovelace",
    manufacturerContactEmail: "ada@example.com",
    version: 0,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
    createdBy: "33333333-3333-4333-8333-333333333333",
    updatedBy: "33333333-3333-4333-8333-333333333333",
  },
} as const;

const CREATE_INPUT = {
  legalName: "Analytical Engines Ltd",
  registeredAddress: {
    addressLine1: "1 Engine Way",
    locality: "London",
    postalCode: "SW1A 1AA",
    country: "GB",
  },
  mainEstablishmentCountry: "GB",
  phone: "+442079460000",
  manufacturerContactName: "Ada Lovelace",
  manufacturerContactEmail: "ADA@EXAMPLE.COM",
  idempotencyKey: "44444444-4444-4444-8444-444444444444",
} as const;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("organizationsApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a legal-profile organization through the authenticated API boundary", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async () => jsonResponse(ORGANIZATION));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      organizationsApi.create(CREATE_INPUT, signal),
    ).resolves.toEqual(ORGANIZATION);

    expect(fetcher).toHaveBeenCalledWith("/api/v1/organizations", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...CREATE_INPUT,
        manufacturerContactEmail: "ada@example.com",
      }),
    });
  });

  it("validates creation input before it sends a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      organizationsApi.create({ ...CREATE_INPUT, legalName: " " }),
    ).rejects.toMatchObject({ kind: "invalid_request" });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("gets the current organization and onboarding progress through exact response schemas", async () => {
    const onboarding = {
      organization: ORGANIZATION,
      stages: [
        {
          stage: "organization_details",
          status: "completed",
          resourceIds: [ORGANIZATION.legalProfile.id],
          unavailableResourceIds: [],
          completedAt: "2026-08-10T10:00:00.000Z",
          actorId: "33333333-3333-4333-8333-333333333333",
          blockReason: null,
        },
        {
          stage: "first_product",
          status: "blocked",
          resourceIds: [],
          unavailableResourceIds: [],
          completedAt: null,
          actorId: null,
          blockReason: "awaiting_authoritative_product",
        },
        {
          stage: "first_sbom",
          status: "blocked",
          resourceIds: [],
          unavailableResourceIds: [],
          completedAt: null,
          actorId: null,
          blockReason: "awaiting_authoritative_sbom",
        },
        {
          stage: "invite_team",
          status: "pending",
          resourceIds: [],
          unavailableResourceIds: [],
          completedAt: null,
          actorId: null,
          blockReason: null,
        },
        {
          stage: "completed",
          status: "blocked",
          resourceIds: [],
          unavailableResourceIds: [],
          completedAt: null,
          actorId: null,
          blockReason: "awaiting_prior_stage",
        },
      ],
      nextIncompleteStage: "first_product",
      blocked: true,
      integrationAvailability: {
        products: false,
        sbom: false,
        invitations: true,
      },
    } as const;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ organization: ORGANIZATION }))
      .mockResolvedValueOnce(jsonResponse(onboarding));
    vi.stubGlobal("fetch", fetcher);

    await expect(organizationsApi.current()).resolves.toEqual({
      organization: ORGANIZATION,
    });
    await expect(organizationsApi.onboarding()).resolves.toEqual(onboarding);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/organizations/current",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/organizations/current/onboarding",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("switches organizations with the shared input and response schemas", async () => {
    const target = {
      ...ORGANIZATION,
      id: "55555555-5555-4555-8555-555555555555",
    };
    const fetcher = vi.fn(async () => jsonResponse({ organization: target }));
    vi.stubGlobal("fetch", fetcher);

    await expect(organizationsApi.switch(target.id)).resolves.toEqual({
      organization: target,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/v1/organizations/switch", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: target.id }),
    });
  });

  it("replaces the current legal profile through the versioned contract", async () => {
    const input = {
      legalName: CREATE_INPUT.legalName,
      registeredAddress: CREATE_INPUT.registeredAddress,
      mainEstablishmentCountry: CREATE_INPUT.mainEstablishmentCountry,
      phone: CREATE_INPUT.phone,
      manufacturerContactName: CREATE_INPUT.manufacturerContactName,
      manufacturerContactEmail: CREATE_INPUT.manufacturerContactEmail,
      expectedVersion: 0,
    } as const;
    const fetcher = vi.fn(async () => jsonResponse(ORGANIZATION));
    vi.stubGlobal("fetch", fetcher);

    await expect(organizationsApi.updateLegalProfile(input)).resolves.toEqual(
      ORGANIZATION,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/organizations/current/legal-profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          ...input,
          manufacturerContactEmail: "ada@example.com",
        }),
      }),
    );
  });
});
