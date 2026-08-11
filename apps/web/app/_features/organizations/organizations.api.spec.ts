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

  it("uses tenant-scoped administration routes without request body organization ids", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            status: "unconfigured",
            version: 0,
            values: null,
          },
          mfaRolloutReadiness: {
            enrolledMemberCount: 1,
            unenrolledMemberCount: 0,
            safeToEnforce: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          catalog: {
            timezones: ["UTC/Etc"],
            notificationChannels: ["email"],
            aiProviders: ["none"],
            dataResidencies: ["eu"],
            minimumSessionAgeMinutes: 5,
            maximumSessionAgeMinutes: 43200,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          policies: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              evidenceClass: "sbom",
              version: 1,
              requestedRetentionDays: 365,
              effectiveRetentionDays: 365,
              effectiveFloorDays: 0,
              controllingReasons: [],
              createdAt: "2026-08-10T10:00:00.000Z",
              updatedAt: "2026-08-10T10:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          lifecycle: {
            status: "active",
            version: 1,
            changedAt: "2026-08-10T10:00:00.000Z",
            blockers: [],
            error: null,
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);

    await organizationsApi.settings();
    await organizationsApi.settingsCatalog();
    await organizationsApi.retention();
    await organizationsApi.lifecycle();

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/organizations/current/settings",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/organizations/current/settings/catalog",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/v1/organizations/current/retention",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      "/api/v1/organizations/current/lifecycle",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
  });

  it("submits tenant administration mutations through shared contracts", async () => {
    const exportJob = {
      id: "77777777-7777-4777-8777-777777777777",
      status: "queued",
      progress: { completedParts: 0, totalParts: 1 },
      error: null,
      manifest: null,
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
    } as const;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          export: exportJob,
          idempotent: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ export: exportJob }))
      .mockResolvedValueOnce(jsonResponse({ export: exportJob }))
      .mockResolvedValueOnce(
        jsonResponse({
          url: "https://exports.example.test/file.zip",
          filename: "organization-export.zip",
          expiresInSeconds: 300,
        }),
      );
    vi.stubGlobal("fetch", fetcher);

    await organizationsApi.requestExport({
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    });
    await organizationsApi.exportStatus(exportJob.id);
    await organizationsApi.latestExport();
    await organizationsApi.downloadExport(exportJob.id);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/organizations/current/exports",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "88888888-8888-4888-8888-888888888888",
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/v1/organizations/current/exports/${exportJob.id}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/v1/organizations/current/exports/latest",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      `/api/v1/organizations/current/exports/${exportJob.id}/download`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates export path parameters before sending requests", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      Promise.resolve().then(() => organizationsApi.exportStatus("../not-safe")),
    ).rejects.toMatchObject({
      kind: "invalid_request",
    });
    await expect(
      Promise.resolve().then(() => organizationsApi.downloadExport("not-a-uuid")),
    ).rejects.toMatchObject({
      kind: "invalid_request",
    });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses exact current-tenant methods for settings, retention, and lifecycle commands", async () => {
    const lifecycle = {
      status: "active",
      version: 4,
      changedAt: "2026-08-10T10:00:00.000Z",
      blockers: [],
      error: null,
    } as const;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            status: "configured",
            version: 1,
            values: {
              timezone: "Europe/London",
              workingDays: ["monday"],
              holidays: [],
              notificationChannelIds: ["email"],
              mfaEnforcementDate: null,
              maximumSessionAgeMinutes: 60,
              aiProviderId: "disabled",
              dataResidencyId: "eu",
            },
          },
          mfaRolloutReadiness: {
            enrolledMemberCount: 1,
            unenrolledMemberCount: 0,
            safeToEnforce: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          policies: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              evidenceClass: "sbom",
              version: 1,
              requestedRetentionDays: 365,
              effectiveRetentionDays: 365,
              effectiveFloorDays: 0,
              controllingReasons: [],
              createdAt: "2026-08-10T10:00:00.000Z",
              updatedAt: "2026-08-10T10:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          reauthenticationGrantId: "77777777-7777-4777-8777-777777777777",
          expiresAt: "2026-08-10T10:05:00.000Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ lifecycle }))
      .mockResolvedValueOnce(jsonResponse({ lifecycle }))
      .mockResolvedValueOnce(jsonResponse({ lifecycle }));
    vi.stubGlobal("fetch", fetcher);

    await organizationsApi.updateSettings({
      expectedVersion: 0,
      values: {
        timezone: "Europe/London",
        workingDays: ["monday"],
        holidays: [],
        notificationChannelIds: ["email"],
        mfaEnforcementDate: null,
        maximumSessionAgeMinutes: 60,
        aiProviderId: "disabled",
        dataResidencyId: "eu",
      },
    });
    await organizationsApi.updateRetention({
      expectedVersion: 1,
      evidenceClass: "sbom",
      requestedRetentionDays: 365,
    });
    const grant = await organizationsApi.reauthenticate({
      password: "not-persisted",
    });
    await organizationsApi.deactivate({
      reauthenticationGrantId: grant.reauthenticationGrantId,
      expectedVersion: 4,
      confirmation: "DEACTIVATE ORGANIZATION",
    });
    await organizationsApi.schedulePurge({
      reauthenticationGrantId: grant.reauthenticationGrantId,
      expectedVersion: 4,
      confirmation: "DELETE analytical-engines-ltd",
    });
    await organizationsApi.recover({
      reauthenticationGrantId: grant.reauthenticationGrantId,
      expectedVersion: 4,
    });

    expect(fetcher.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ["/api/v1/organizations/current/settings", "PATCH"],
      ["/api/v1/organizations/current/retention", "PATCH"],
      ["/api/v1/organizations/current/lifecycle/reauthentication", "POST"],
      ["/api/v1/organizations/current/lifecycle/deactivate", "POST"],
      ["/api/v1/organizations/current/lifecycle/purge", "POST"],
      ["/api/v1/organizations/current/lifecycle/recover", "POST"],
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(String(init?.body ?? "")).not.toContain("organizationId");
    }
  });
});
