import type {
  CreateLegalProfileInput,
  OnboardingResponse,
} from "./organizations/types/index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createLegalProfileInputSchema,
  createOrganizationInputSchema,
  currentOrganizationResponseSchema,
  onboardingResponseSchema,
  onboardingStageRecordSchema,
  switchOrganizationInputSchema,
  switchOrganizationResponseSchema,
  updateLegalProfileInputSchema,
} from "./organizations.js";

const idempotencyKey = "1ad67e3b-6e5e-4cde-870f-2225e7da1200";

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
