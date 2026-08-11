import type {
  CreateLegalProfileInput,
  OrganizationExport,
  OrganizationExportParams,
  OrganizationExportResponse,
  OrganizationLifecycle,
  OrganizationSettings,
  MfaRolloutReadiness,
  OnboardingResponse,
  RetentionPolicy,
} from "./organizations/types/index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createLegalProfileInputSchema,
  createOrganizationInputSchema,
  currentOrganizationResponseSchema,
  destructiveReauthenticationInputSchema,
  exportAttachmentDownloadResponseSchema,
  exportRequestInputSchema,
  exportRequestResponseSchema,
  latestOrganizationExportResponseSchema,
  organizationLifecycleResponseSchema,
  organizationAdministrationErrorSchema,
  organizationExportSchema,
  organizationExportParamsSchema,
  organizationExportResponseSchema,
  organizationSettingsCatalogResponseSchema,
  organizationSettingsResponseSchema,
  onboardingResponseSchema,
  onboardingStageRecordSchema,
  retentionPolicyResponseSchema,
  retentionPolicyUpdateInputSchema,
  scheduleOrganizationPurgeInputSchema,
  switchOrganizationInputSchema,
  switchOrganizationResponseSchema,
  updateOrganizationSettingsInputSchema,
  updateLegalProfileInputSchema,
} from "./organizations.js";

const idempotencyKey = "1ad67e3b-6e5e-4cde-870f-2225e7da1200";

describe("organization administration error contracts", () => {
  it("accepts a distinct non-sensitive malformed-provider code", () => {
    expect(
      organizationAdministrationErrorSchema.parse({
        code: "malformed_provider",
        message: "Organization administration request could not be completed.",
      }),
    ).toMatchObject({ code: "malformed_provider" });
  });
});

describe("organization export resume contracts", () => {
  it("makes the absence of a server-owned latest export explicit", () => {
    expect(latestOrganizationExportResponseSchema.parse({ export: null })).toEqual({
      export: null,
    });
    expect(
      latestOrganizationExportResponseSchema.safeParse({ export: null, extra: true })
        .success,
    ).toBe(false);
  });
});

const legalProfileInput = {
  legalName: "  Acme Holdings Limited  ",
  registeredAddress: {
    addressLine1: "  1 Example Street  ",
    addressLine2: "Suite 4B",
    locality: "  London  ",
    administrativeArea: "Greater London",
    postalCode: "SW1A 1AA",
    country: "GB",
  },
  mainEstablishmentCountry: "IE",
  phone: "+35315551234",
  manufacturerContactName: "  Ada Manufacturer  ",
  manufacturerContactEmail: "  ADA.MANUFACTURER@EXAMPLE.COM  ",
  idempotencyKey,
};

const legalProfileUpdateInput = {
  legalName: legalProfileInput.legalName,
  registeredAddress: legalProfileInput.registeredAddress,
  mainEstablishmentCountry: legalProfileInput.mainEstablishmentCountry,
  phone: legalProfileInput.phone,
  manufacturerContactName: legalProfileInput.manufacturerContactName,
  manufacturerContactEmail: legalProfileInput.manufacturerContactEmail,
  expectedVersion: 1,
};

const organization = {
  id: "2ad67e3b-6e5e-4cde-870f-2225e7da1200",
  name: "Acme Holdings",
  slug: "acme-holdings",
  legalProfile: {
    id: "2ad67e3b-6e5e-4cde-870f-2225e7da1201",
    legalName: "Acme Holdings Limited",
    registeredAddress: {
      addressLine1: "1 Example Street",
      addressLine2: "Suite 4B",
      locality: "London",
      administrativeArea: "Greater London",
      postalCode: "SW1A 1AA",
      country: "GB",
    },
    mainEstablishmentCountry: "IE",
    phone: "+35315551234",
    manufacturerContactName: "Ada Manufacturer",
    manufacturerContactEmail: "ada.manufacturer@example.com",
    version: 1,
    createdAt: "2026-08-10T11:30:00.000Z",
    updatedAt: "2026-08-10T11:30:00.000Z",
    createdBy: "3ad67e3b-6e5e-4cde-870f-2225e7da1200",
    updatedBy: "3ad67e3b-6e5e-4cde-870f-2225e7da1200",
  },
};

describe("organization legal-profile request contracts", () => {
  it("parses a legal profile while retaining distinct registered and main-establishment countries", () => {
    expect(createLegalProfileInputSchema.parse(legalProfileInput)).toEqual({
      ...legalProfileInput,
      legalName: "Acme Holdings Limited",
      manufacturerContactName: "Ada Manufacturer",
      manufacturerContactEmail: "ada.manufacturer@example.com",
      registeredAddress: {
        ...legalProfileInput.registeredAddress,
        addressLine1: "1 Example Street",
        locality: "London",
      },
    });
  });

  it("requires a separate main-establishment country instead of inferring it from the address", () => {
    const withoutMainCountry = {
      legalName: legalProfileInput.legalName,
      registeredAddress: legalProfileInput.registeredAddress,
      phone: legalProfileInput.phone,
      manufacturerContactName: legalProfileInput.manufacturerContactName,
      manufacturerContactEmail: legalProfileInput.manufacturerContactEmail,
      idempotencyKey: legalProfileInput.idempotencyKey,
    };

    expect(
      createLegalProfileInputSchema.safeParse(withoutMainCountry).success,
    ).toBe(false);
  });

  it("uses the legal profile as the entire create-organization request", () => {
    expect(createOrganizationInputSchema.parse(legalProfileInput)).toEqual(
      createLegalProfileInputSchema.parse(legalProfileInput),
    );
    expect(
      createOrganizationInputSchema.safeParse({
        ...legalProfileInput,
        name: "Do not duplicate legalName",
      }).success,
    ).toBe(false);
  });

  it.each([
    { ...legalProfileInput, idempotencyKey: "not-a-uuid" },
    { ...legalProfileInput, mainEstablishmentCountry: "UK" },
    {
      ...legalProfileInput,
      registeredAddress: {
        ...legalProfileInput.registeredAddress,
        country: "XX",
      },
    },
    {
      ...legalProfileInput,
      registeredAddress: {
        ...legalProfileInput.registeredAddress,
        postalCode: undefined,
      },
    },
    { ...legalProfileInput, phone: "35315551234" },
    { ...legalProfileInput, phone: "+0123456789" },
    { ...legalProfileInput, manufacturerContactName: "" },
    { ...legalProfileInput, manufacturerContactEmail: "not-an-email" },
    { ...legalProfileInput, unexpected: true },
    {
      ...legalProfileInput,
      registeredAddress: {
        ...legalProfileInput.registeredAddress,
        unexpected: true,
      },
    },
  ])("rejects invalid legal-profile input %#", (value) => {
    expect(createLegalProfileInputSchema.safeParse(value).success).toBe(false);
  });

  it("requires a complete legal-profile replacement and expected version for an update", () => {
    expect(
      updateLegalProfileInputSchema.parse(legalProfileUpdateInput),
    ).toEqual({
      ...legalProfileUpdateInput,
      legalName: "Acme Holdings Limited",
      manufacturerContactName: "Ada Manufacturer",
      manufacturerContactEmail: "ada.manufacturer@example.com",
      registeredAddress: {
        ...legalProfileInput.registeredAddress,
        addressLine1: "1 Example Street",
        locality: "London",
      },
    });
  });

  it.each([
    {
      registeredAddress: legalProfileUpdateInput.registeredAddress,
      mainEstablishmentCountry:
        legalProfileUpdateInput.mainEstablishmentCountry,
      manufacturerContactName: legalProfileUpdateInput.manufacturerContactName,
      manufacturerContactEmail:
        legalProfileUpdateInput.manufacturerContactEmail,
      expectedVersion: legalProfileUpdateInput.expectedVersion,
    },
    {
      legalName: legalProfileUpdateInput.legalName,
      mainEstablishmentCountry:
        legalProfileUpdateInput.mainEstablishmentCountry,
      manufacturerContactName: legalProfileUpdateInput.manufacturerContactName,
      manufacturerContactEmail:
        legalProfileUpdateInput.manufacturerContactEmail,
      expectedVersion: legalProfileUpdateInput.expectedVersion,
    },
    {
      legalName: legalProfileUpdateInput.legalName,
      registeredAddress: legalProfileUpdateInput.registeredAddress,
      manufacturerContactName: legalProfileUpdateInput.manufacturerContactName,
      manufacturerContactEmail:
        legalProfileUpdateInput.manufacturerContactEmail,
      expectedVersion: legalProfileUpdateInput.expectedVersion,
    },
    {
      ...legalProfileUpdateInput,
      expectedVersion: -1,
    },
    {
      ...legalProfileUpdateInput,
      manufacturerContactEmail: undefined,
    },
    {
      ...legalProfileUpdateInput,
      unexpected: true,
    },
  ])("rejects an incomplete, stale, or non-strict update %#", (value) => {
    expect(updateLegalProfileInputSchema.safeParse(value).success).toBe(false);
  });

  it("derives trusted request types from parsed outputs", () => {
    expectTypeOf(
      createLegalProfileInputSchema.parse,
    ).returns.toEqualTypeOf<CreateLegalProfileInput>();
  });
});

describe("organization current, switch, and onboarding response contracts", () => {
  it("accepts a no-organization current response and a selected switch response", () => {
    expect(
      currentOrganizationResponseSchema.parse({ organization: null }),
    ).toEqual({
      organization: null,
    });
    expect(switchOrganizationResponseSchema.parse({ organization })).toEqual({
      organization,
    });
  });

  it("allows the full canonical legal-name length on organization output", () => {
    expect(
      switchOrganizationResponseSchema.parse({
        organization: { ...organization, name: "A".repeat(200) },
      }).organization.name,
    ).toHaveLength(200);
    expect(
      switchOrganizationResponseSchema.safeParse({
        organization: { ...organization, name: "A".repeat(201) },
      }).success,
    ).toBe(false);
  });

  it("validates the organization selected by a switch request", () => {
    expect(
      switchOrganizationInputSchema.parse({ organizationId: organization.id }),
    ).toEqual({ organizationId: organization.id });
    expect(
      switchOrganizationInputSchema.safeParse({ organizationId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("exposes onboarding stage and evidence availability explicitly", () => {
    const onboarding = {
      organization,
      stages: [
        {
          stage: "organization_details",
          status: "completed",
          resourceIds: [organization.id],
          unavailableResourceIds: [],
          completedAt: "2026-08-10T11:30:00.000Z",
          actorId: "3ad67e3b-6e5e-4cde-870f-2225e7da1200",
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
          status: "pending",
          resourceIds: [],
          unavailableResourceIds: ["4ad67e3b-6e5e-4cde-870f-2225e7da1200"],
          completedAt: null,
          actorId: null,
          blockReason: null,
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
          status: "pending",
          resourceIds: [],
          unavailableResourceIds: [],
          completedAt: null,
          actorId: null,
          blockReason: null,
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

    expect(onboardingResponseSchema.parse(onboarding)).toEqual(onboarding);
    expect(
      onboardingResponseSchema.safeParse({
        ...onboarding,
        stages: [...onboarding.stages].reverse(),
      }).success,
    ).toBe(false);
    expectTypeOf(
      onboardingResponseSchema.parse,
    ).returns.toEqualTypeOf<OnboardingResponse>();
  });

  it.each([
    {
      stage: "organization_details",
      status: "completed",
      resourceIds: [],
      completedAt: null,
      actorId: null,
      blockReason: null,
    },
    {
      stage: "first_product",
      status: "blocked",
      resourceIds: [],
      completedAt: null,
      actorId: null,
      blockReason: null,
    },
    {
      stage: "first_sbom",
      status: "pending",
      resourceIds: [],
      completedAt: "2026-08-10T11:30:00.000Z",
      actorId: "3ad67e3b-6e5e-4cde-870f-2225e7da1200",
      blockReason: null,
    },
  ])("rejects impossible stage metadata %#", (stage) => {
    expect(onboardingStageRecordSchema.safeParse(stage).success).toBe(false);
  });

  it.each([
    {
      organization,
      stages: [],
      nextIncompleteStage: "unknown",
      blocked: false,
      integrationAvailability: {
        products: true,
        sbom: true,
        invitations: true,
      },
    },
    {
      organization,
      stages: [],
      nextIncompleteStage: null,
      blocked: "no",
      integrationAvailability: {
        products: true,
        sbom: true,
        invitations: true,
      },
    },
    {
      organization,
      stages: [],
      nextIncompleteStage: null,
      blocked: false,
      integrationAvailability: {
        products: true,
        sbom: true,
        invitations: true,
      },
      unexpected: true,
    },
  ])("rejects invalid strict onboarding output %#", (value) => {
    expect(onboardingResponseSchema.safeParse(value).success).toBe(false);
  });
});

describe("organization settings contracts", () => {
  const settings = {
    timezone: "Asia/Kolkata",
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    holidays: ["2026-01-26", "2026-08-15"],
    notificationChannelIds: ["email", "in_app"],
    mfaEnforcementDate: "2026-09-01",
    maximumSessionAgeMinutes: 480,
    aiProviderId: "openai",
    dataResidencyId: "in",
  } as const;

  it("models an explicitly unconfigured settings record without inferred values", () => {
    expect(
      organizationSettingsResponseSchema.parse({
        settings: { status: "unconfigured", version: 0, values: null },
        mfaRolloutReadiness: {
          enrolledMemberCount: 3,
          unenrolledMemberCount: 0,
          safeToEnforce: true,
        },
      }),
    ).toEqual({
      settings: { status: "unconfigured", version: 0, values: null },
      mfaRolloutReadiness: {
        enrolledMemberCount: 3,
        unenrolledMemberCount: 0,
        safeToEnforce: true,
      },
    });
  });

  it("exposes an authoritative PII-free MFA rollout readiness summary", () => {
    const parsed = organizationSettingsResponseSchema.parse({
      settings: { status: "configured", version: 2, values: settings },
      mfaRolloutReadiness: {
        enrolledMemberCount: 2,
        unenrolledMemberCount: 1,
        safeToEnforce: false,
      },
    });
    expect(parsed.mfaRolloutReadiness.unenrolledMemberCount).toBe(1);
    expectTypeOf(
      parsed.mfaRolloutReadiness,
    ).toEqualTypeOf<MfaRolloutReadiness>();
    expect(
      organizationSettingsResponseSchema.safeParse({
        settings: { status: "configured", version: 2, values: settings },
        mfaRolloutReadiness: {
          enrolledMemberCount: 2,
          unenrolledMemberCount: 1,
          safeToEnforce: true,
        },
      }).success,
    ).toBe(false);
  });

  it("validates versioned configured settings with calendar uniqueness", () => {
    const parsed = updateOrganizationSettingsInputSchema.parse({
      expectedVersion: 4,
      values: settings,
    });
    expect(parsed.values).toEqual(settings);
    expectTypeOf(parsed.values).toEqualTypeOf<OrganizationSettings["values"]>();
  });

  it.each([
    { ...settings, timezone: "browser-local-timezone" },
    { ...settings, workingDays: [] },
    { ...settings, workingDays: ["monday", "monday"] },
    { ...settings, holidays: ["2026-01-26", "2026-01-26"] },
    { ...settings, notificationChannelIds: ["email", "email"] },
    { ...settings, maximumSessionAgeMinutes: 0 },
    { ...settings, aiProviderId: "OpenAI" },
    { ...settings, dataResidencyId: "India" },
  ])("rejects invalid organization settings %#", (values) => {
    expect(
      updateOrganizationSettingsInputSchema.safeParse({
        expectedVersion: 0,
        values,
      }).success,
    ).toBe(false);
  });

  it("accepts a strict server catalog with dynamic provider identifiers", () => {
    expect(
      organizationSettingsCatalogResponseSchema.parse({
        catalog: {
          timezones: ["Asia/Kolkata", "Europe/Dublin"],
          notificationChannels: ["email", "in_app"],
          aiProviders: ["openai", "anthropic"],
          dataResidencies: ["in", "eu"],
          minimumSessionAgeMinutes: 5,
          maximumSessionAgeMinutes: 43200,
        },
      }),
    ).toEqual({
      catalog: {
        timezones: ["Asia/Kolkata", "Europe/Dublin"],
        notificationChannels: ["email", "in_app"],
        aiProviders: ["openai", "anthropic"],
        dataResidencies: ["in", "eu"],
        minimumSessionAgeMinutes: 5,
        maximumSessionAgeMinutes: 43200,
      },
    });
  });

  it("rejects a catalog with impossible session bounds", () => {
    expect(
      organizationSettingsCatalogResponseSchema.safeParse({
        catalog: {
          timezones: ["Asia/Kolkata"],
          notificationChannels: ["email"],
          aiProviders: ["openai"],
          dataResidencies: ["in"],
          minimumSessionAgeMinutes: 60,
          maximumSessionAgeMinutes: 5,
        },
      }).success,
    ).toBe(false);
  });
});

describe("organization retention contracts", () => {
  const retentionPolicy = {
    id: "4ad67e3b-6e5e-4cde-870f-2225e7da1200",
    evidenceClass: "technical_documentation",
    version: 3,
    requestedRetentionDays: 30,
    effectiveRetentionDays: 365,
    effectiveFloorDays: 365,
    controllingReasons: [
      {
        kind: "product",
        recordId: "5ad67e3b-6e5e-4cde-870f-2225e7da1200",
        requiredRetentionDays: 90,
      },
      {
        kind: "evidence_class",
        recordId: "6ad67e3b-6e5e-4cde-870f-2225e7da1200",
        requiredRetentionDays: 180,
      },
      {
        kind: "obligation",
        recordId: "7ad67e3b-6e5e-4cde-870f-2225e7da1200",
        requiredRetentionDays: 365,
      },
      {
        kind: "legal_hold",
        recordId: "8ad67e3b-6e5e-4cde-870f-2225e7da1200",
        requiredRetentionDays: 365,
      },
    ],
    createdAt: "2026-08-10T11:30:00.000Z",
    updatedAt: "2026-08-10T11:30:00.000Z",
  } as const;

  it("parses a versioned retention policy and each controlling floor reason", () => {
    const parsed = retentionPolicyResponseSchema.parse({
      policies: [retentionPolicy],
    }).policies[0]!;
    expect(parsed.effectiveFloorDays).toBe(365);
    expectTypeOf(parsed).toEqualTypeOf<RetentionPolicy>();
  });

  it("requires an optimistic-concurrency version and evidence class for a retention update", () => {
    expect(
      retentionPolicyUpdateInputSchema.safeParse({
        evidenceClass: "technical_documentation",
        requestedRetentionDays: 30,
      }).success,
    ).toBe(false);
    expect(
      retentionPolicyUpdateInputSchema.safeParse({
        expectedVersion: 3,
        evidenceClass: "Technical-Documentation",
        requestedRetentionDays: 30,
      }).success,
    ).toBe(false);
    expect(
      retentionPolicyUpdateInputSchema.parse({
        expectedVersion: 3,
        evidenceClass: "technical_documentation",
        requestedRetentionDays: 30,
      }),
    ).toMatchObject({ evidenceClass: "technical_documentation" });
  });

  it("rejects a retention output whose effective floor omits a controlling record", () => {
    expect(
      retentionPolicyResponseSchema.safeParse({
        policies: [{ ...retentionPolicy, effectiveFloorDays: 180 }],
      }).success,
    ).toBe(false);
  });

  it("accepts an unconstrained policy whose effective value is requested retention", () => {
    expect(
      retentionPolicyResponseSchema.parse({
        policies: [
          {
            ...retentionPolicy,
            requestedRetentionDays: 30,
            effectiveRetentionDays: 30,
            effectiveFloorDays: 0,
            controllingReasons: [],
          },
        ],
      }).policies[0]!.effectiveRetentionDays,
    ).toBe(30);
  });

  it("returns a strict policy set with each evidence class exactly once", () => {
    const productSafety = {
      ...retentionPolicy,
      id: "9ad67e3b-6e5e-4cde-870f-2225e7da1201",
      evidenceClass: "product_safety",
    } as const;
    expect(
      retentionPolicyResponseSchema
        .parse({
          policies: [retentionPolicy, productSafety],
        })
        .policies.map((policy) => policy.evidenceClass),
    ).toEqual(["technical_documentation", "product_safety"]);
    expect(
      retentionPolicyResponseSchema.safeParse({
        policies: [retentionPolicy, retentionPolicy],
      }).success,
    ).toBe(false);
    expect(
      retentionPolicyResponseSchema.safeParse({ policies: [] }).success,
    ).toBe(false);
    expect(
      retentionPolicyResponseSchema.safeParse({
        policies: [retentionPolicy],
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});

describe("organization export contracts", () => {
  const exportJob = {
    id: "9ad67e3b-6e5e-4cde-870f-2225e7da1200",
    status: "completed",
    progress: { completedParts: 2, totalParts: 2 },
    error: null,
    manifest: {
      formatVersion: 1,
      sha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      fileCount: 2,
      verifiedAt: "2026-08-10T11:35:00.000Z",
    },
    createdAt: "2026-08-10T11:30:00.000Z",
    updatedAt: "2026-08-10T11:35:00.000Z",
  } as const;

  it("requires an idempotency key for an export request", () => {
    expect(exportRequestInputSchema.safeParse({}).success).toBe(false);
    expect(exportRequestInputSchema.parse({ idempotencyKey })).toEqual({
      idempotencyKey,
    });
  });

  it("exposes verified manifests and typed export progress", () => {
    const parsed = exportRequestResponseSchema.parse({
      export: exportJob,
      idempotent: false,
    }).export;
    expect(parsed.manifest?.verifiedAt).toBe(exportJob.manifest.verifiedAt);
    expectTypeOf(parsed).toEqualTypeOf<OrganizationExport>();
  });

  it("validates strict export path parameters and a single-export response", () => {
    const params = organizationExportParamsSchema.parse({
      exportId: exportJob.id,
    });
    expect(params).toEqual({ exportId: exportJob.id });
    expectTypeOf(params).toEqualTypeOf<OrganizationExportParams>();

    const response = organizationExportResponseSchema.parse({
      export: exportJob,
    });
    expect(response.export.id).toBe(exportJob.id);
    expectTypeOf(response).toEqualTypeOf<OrganizationExportResponse>();

    expect(
      organizationExportParamsSchema.safeParse({
        exportId: exportJob.id,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      organizationExportResponseSchema.safeParse({
        export: exportJob,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("limits attachment links to a short-lived response", () => {
    expect(
      exportAttachmentDownloadResponseSchema.parse({
        url: "https://downloads.example.com/exports/9",
        filename: "organization-export.zip",
        expiresInSeconds: 900,
      }),
    ).toMatchObject({ expiresInSeconds: 900 });
    expect(
      exportAttachmentDownloadResponseSchema.safeParse({
        url: "https://downloads.example.com/exports/9",
        filename: "organization-export.zip",
        expiresInSeconds: 901,
      }).success,
    ).toBe(false);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "ftp://downloads.example.com/exports/9",
    ]) {
      expect(
        exportAttachmentDownloadResponseSchema.safeParse({
          url,
          filename: "organization-export.zip",
          expiresInSeconds: 60,
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    {
      ...exportJob,
      status: "running",
      progress: { completedParts: 2, totalParts: 1 },
      manifest: null,
    },
    {
      ...exportJob,
      status: "completed",
      manifest: null,
    },
    {
      ...exportJob,
      status: "completed",
      progress: { completedParts: 1, totalParts: 2 },
    },
    {
      ...exportJob,
      status: "failed",
      manifest: null,
      error: null,
    },
    {
      ...exportJob,
      status: "running",
      manifest: null,
      error: {
        code: "unavailable",
        message: "Organization administration request could not be completed.",
      },
    },
  ])(
    "rejects inconsistent export progress, manifest, and safe-error states %#",
    (value) => {
      expect(organizationExportSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("organization lifecycle contracts", () => {
  it("exposes the persistent lifecycle state without leaking an internal failure", () => {
    const parsed = organizationLifecycleResponseSchema.parse({
      lifecycle: {
        status: "purge_blocked",
        version: 2,
        changedAt: "2026-08-10T11:30:00.000Z",
        blockers: [
          {
            kind: "legal_hold",
            recordId: "8ad67e3b-6e5e-4cde-870f-2225e7da1200",
            requiredRetentionDays: 365,
          },
        ],
        error: {
          code: "invalid_state",
          message:
            "Organization administration request could not be completed.",
        },
      },
    }).lifecycle;
    expect(parsed.status).toBe("purge_blocked");
    expectTypeOf(parsed).toEqualTypeOf<OrganizationLifecycle>();
  });

  it("requires every purge blocker to be explicit and forbids blockers in other states", () => {
    const lifecycle = {
      version: 2,
      changedAt: "2026-08-10T11:30:00.000Z",
      error: null,
    } as const;
    expect(
      organizationLifecycleResponseSchema.safeParse({
        lifecycle: { ...lifecycle, status: "purge_blocked", blockers: [] },
      }).success,
    ).toBe(false);
    expect(
      organizationLifecycleResponseSchema.safeParse({
        lifecycle: {
          ...lifecycle,
          status: "active",
          blockers: [
            {
              kind: "product",
              recordId: "5ad67e3b-6e5e-4cde-870f-2225e7da1200",
              requiredRetentionDays: 30,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("allows only generic non-secret operational blockers", () => {
    const lifecycle = {
      status: "purge_blocked",
      version: 2,
      changedAt: "2026-08-10T11:30:00.000Z",
      error: null,
    } as const;
    expect(
      organizationLifecycleResponseSchema.parse({
        lifecycle: {
          ...lifecycle,
          blockers: [
            { kind: "unavailable", code: "dependency_unavailable" },
            { kind: "worker_failure", code: "worker_failure" },
          ],
        },
      }).lifecycle.blockers,
    ).toHaveLength(2);
    expect(
      organizationLifecycleResponseSchema.safeParse({
        lifecycle: {
          ...lifecycle,
          blockers: [
            {
              kind: "unavailable",
              code: "provider_timeout",
              recordId: "8ad67e3b-6e5e-4cde-870f-2225e7da1200",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("requires fresh reauthentication and exact confirmation for purge scheduling", () => {
    expect(
      destructiveReauthenticationInputSchema.safeParse({ password: "" })
        .success,
    ).toBe(false);
    expect(
      destructiveReauthenticationInputSchema.parse({
        password: "Password123",
        mfaCode: "123456",
      }),
    ).toMatchObject({ mfaCode: "123456" });
    expect(
      destructiveReauthenticationInputSchema.safeParse({
        password: "Password123",
        mfaCode: "1234567",
      }).success,
    ).toBe(false);
    expect(
      scheduleOrganizationPurgeInputSchema.safeParse({
        reauthenticationGrantId: idempotencyKey,
        expectedVersion: 2,
        confirmation: "delete acme-holdings",
      }).success,
    ).toBe(false);
    expect(
      scheduleOrganizationPurgeInputSchema.safeParse({
        reauthenticationGrantId: idempotencyKey,
        confirmation: "DELETE ORGANIZATION",
      }).success,
    ).toBe(false);
    expect(
      scheduleOrganizationPurgeInputSchema.safeParse({
        reauthenticationGrantId: idempotencyKey,
        expectedVersion: 2,
        confirmation: "DELETE acme--holdings",
      }).success,
    ).toBe(false);
    expect(
      scheduleOrganizationPurgeInputSchema.parse({
        reauthenticationGrantId: idempotencyKey,
        expectedVersion: 2,
        confirmation: "DELETE acme-holdings",
      }),
    ).toMatchObject({ confirmation: "DELETE acme-holdings" });
  });
});
