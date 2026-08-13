import { describe, expect, expectTypeOf, it } from "vitest";

import {
  EU27_MEMBER_STATE_CODES,
  addReleaseMarketAvailabilityInputSchema,
  correctPlacedOnMarketDateInputSchema,
  correctReleaseMarketAvailabilityInputSchema,
  createProductInputSchema,
  createReleaseInputSchema,
  memberStateReferenceSchema,
  memberStatesResponseSchema,
  productListQuerySchema,
  productTypeSchema,
  releaseLifecycleTimelineResponseSchema,
  releaseLifecycleStateSchema,
  releaseMarketAvailabilitySchema,
  releaseMarketAvailabilityParamsSchema,
  releaseMarketAvailabilityResponseSchema,
  releaseMarketLifecycleDomainErrorSchema,
  removeReleaseMarketAvailabilityInputSchema,
  releaseParamsSchema,
  releaseResponseSchema,
  transitionReleaseLifecycleInputSchema,
  updateProductInputSchema,
  updateReleaseInputSchema,
} from "./products.js";
import type {
  CreateProductInput,
  ReleaseLifecycleState,
  ReleaseMarketAvailability,
} from "./products.js";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  entity: "22222222-2222-4222-8222-222222222222",
  key: "33333333-3333-4333-8333-333333333333",
};

describe("product registry contracts", () => {
  it("parses create commands while preserving display code whitespace", () => {
    const parsed = createProductInputSchema.parse({
      name: "  Sentinel Gateway  ",
      internalCode: "  GW  001  ",
      productType: "hardware_with_software",
      description: "  Gateway device  ",
      responsibleOwnerId: ids.owner,
      legalEntityId: ids.entity,
      idempotencyKey: ids.key,
    });
    expect(parsed).toMatchObject({
      name: "Sentinel Gateway",
      internalCode: "GW  001",
      description: "Gateway device",
    });
    expectTypeOf<CreateProductInput>().toEqualTypeOf<typeof parsed>();
  });

  it("rejects product identifiers supplied by the browser and empty updates", () => {
    expect(createProductInputSchema.safeParse({ id: ids.owner }).success).toBe(
      false,
    );
    expect(
      updateProductInputSchema.safeParse({ expectedVersion: 0 }).success,
    ).toBe(false);
  });

  it("creates releases in development without accepting generic lifecycle input", () => {
    const parsed = createReleaseInputSchema.parse({
      label: "Release candidate",
      version: "1.0.0-rc.1",
      idempotencyKey: ids.key,
    });
    expect(parsed).toMatchObject({ version: "1.0.0-rc.1" });
    expect("lifecycle" in parsed).toBe(false);
    expect(
      createReleaseInputSchema.safeParse({
        ...parsed,
        lifecycle: "development",
      }).success,
    ).toBe(false);
    expect(
      updateReleaseInputSchema.safeParse({
        expectedVersion: 0,
        lifecycle: "withdrawn",
      }).success,
    ).toBe(false);
  });

  it("bounds list queries and permits only product lifecycle filters", () => {
    expect(
      productListQuerySchema.parse({ page: "2", pageSize: "100" }),
    ).toMatchObject({
      page: 2,
      pageSize: 100,
    });
    expect(productListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
    expect(productTypeSchema.parse("component")).toBe("component");
    expectTypeOf<ProductType>().toEqualTypeOf<
      | "hardware_with_software"
      | "standalone_software"
      | "component"
      | "remote_data_processing"
    >();
  });
});

describe("release market lifecycle contracts", () => {
  const releaseId = "44444444-4444-4444-8444-444444444444";
  const occurredAt = "2026-08-12T10:15:30.000Z";

  it("exposes only the versioned EU-27 member-state client codes", () => {
    expect(EU27_MEMBER_STATE_CODES).toEqual([
      "AT",
      "BE",
      "BG",
      "HR",
      "CY",
      "CZ",
      "DK",
      "EE",
      "FI",
      "FR",
      "DE",
      "GR",
      "HU",
      "IE",
      "IT",
      "LV",
      "LT",
      "LU",
      "MT",
      "NL",
      "PL",
      "PT",
      "RO",
      "SK",
      "SI",
      "ES",
      "SE",
    ]);
    expect(releaseLifecycleStateSchema.parse("end_of_support")).toBe(
      "end_of_support",
    );
    expect(releaseLifecycleStateSchema.safeParse("released").success).toBe(
      false,
    );
    expect(
      memberStateReferenceSchema.parse({
        countryCode: "DE",
        name: "Germany",
        version: 2,
        active: true,
      }),
    ).toMatchObject({ countryCode: "DE", version: 2 });
    expect(
      memberStatesResponseSchema.safeParse({
        memberStates: [
          {
            countryCode: "GB",
            name: "United Kingdom",
            version: 1,
            active: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      memberStateReferenceSchema.safeParse({
        countryCode: "DE",
        name: "Germany",
        version: 2,
        active: true,
        unsupported: true,
      }).success,
    ).toBe(false);
  });

  it("uses country codes at availability command boundaries and preserves read facts", () => {
    expect(
      addReleaseMarketAvailabilityInputSchema.parse({
        countryCode: "DE",
        expectedVersion: 3,
        reason: "Initial German market availability",
      }),
    ).toMatchObject({ countryCode: "DE", expectedVersion: 3 });
    expect(
      removeReleaseMarketAvailabilityInputSchema.parse({
        expectedVersion: 3,
        reason: "No longer supplied in this market",
      }),
    ).toMatchObject({ expectedVersion: 3 });
    expect(
      correctReleaseMarketAvailabilityInputSchema.parse({
        fromCountryCode: "DE",
        toCountryCode: "FR",
        expectedVersion: 3,
      }),
    ).toMatchObject({ fromCountryCode: "DE", toCountryCode: "FR" });
    expect(
      correctReleaseMarketAvailabilityInputSchema.safeParse({
        fromCountryCode: "DE",
        toCountryCode: "DE",
        expectedVersion: 3,
      }).success,
    ).toBe(false);
    expect(
      releaseMarketAvailabilityParamsSchema.parse({
        productId: ids.owner,
        releaseId,
        countryCode: "DE",
      }),
    ).toMatchObject({ countryCode: "DE" });
    expect(
      releaseParamsSchema.parse({
        productId: ids.owner,
        releaseId,
      }),
    ).toMatchObject({ releaseId });
    const availability = releaseMarketAvailabilitySchema.parse({
      countryCode: "DE",
      memberStateName: "Germany",
      referenceVersion: 2,
      availableAt: occurredAt,
      unavailableAt: null,
      active: true,
    });
    expectTypeOf<ReleaseMarketAvailability>().toEqualTypeOf<
      typeof availability
    >();
    expect(
      releaseMarketAvailabilityResponseSchema.parse({
        marketAvailability: [availability],
      }),
    ).toMatchObject({ marketAvailability: [availability] });
    expect(
      releaseMarketAvailabilitySchema.safeParse({
        ...availability,
        active: false,
      }).success,
    ).toBe(false);
  });

  it("accepts only strict UTC-Z timestamps for placement and corrections", () => {
    expect(
      transitionReleaseLifecycleInputSchema.parse({
        targetState: "placed_on_market",
        expectedVersion: 3,
        placedOnMarketAt: occurredAt,
      }),
    ).toMatchObject({
      targetState: "placed_on_market",
      placedOnMarketAt: occurredAt,
    });
    expect(
      transitionReleaseLifecycleInputSchema.safeParse({
        targetState: "placed_on_market",
        expectedVersion: 3,
        placedOnMarketAt: "2026-08-12T15:45:30.000+05:30",
      }).success,
    ).toBe(false);
    expect(
      transitionReleaseLifecycleInputSchema.safeParse({
        targetState: "placed_on_market",
        expectedVersion: 3,
      }).success,
    ).toBe(false);
    expect(
      transitionReleaseLifecycleInputSchema.safeParse({
        targetState: "in_support",
        expectedVersion: 3,
        placedOnMarketAt: occurredAt,
      }).success,
    ).toBe(false);
    expect(
      correctPlacedOnMarketDateInputSchema.parse({
        correctedPlacedOnMarketAt: occurredAt,
        expectedVersion: 4,
        reason: "Corrected from the signed placement record",
      }),
    ).toMatchObject({ correctedPlacedOnMarketAt: occurredAt });
    expect(
      correctPlacedOnMarketDateInputSchema.safeParse({
        correctedPlacedOnMarketAt: "2026-08-12T10:15:30.000+00:00",
        expectedVersion: 4,
        reason: "Corrected from the signed placement record",
      }).success,
    ).toBe(false);
  });

  it("requires meaningful withdrawal and correction reasons after trimming", () => {
    expect(
      transitionReleaseLifecycleInputSchema.safeParse({
        targetState: "withdrawn",
        expectedVersion: 5,
        reason: "   ",
      }).success,
    ).toBe(false);
    expect(
      correctPlacedOnMarketDateInputSchema.safeParse({
        correctedPlacedOnMarketAt: occurredAt,
        expectedVersion: 5,
        reason: "   ",
      }).success,
    ).toBe(false);
  });

  it("parses immutable lifecycle timeline facts", () => {
    expect(
      releaseLifecycleTimelineResponseSchema.parse({
        timeline: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            eventType: "transition",
            beforeLifecycle: "development",
            afterLifecycle: "placed_on_market",
            originalPlacedOnMarketAt: null,
            correctedPlacedOnMarketAt: occurredAt,
            actorId: ids.owner,
            reason: null,
            correlationId: "66666666-6666-4666-8666-666666666666",
            occurredAt,
          },
        ],
      }),
    ).toMatchObject({
      timeline: [expect.objectContaining({ eventType: "transition" })],
    });
    expect(
      releaseLifecycleTimelineResponseSchema.safeParse({
        timeline: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            eventType: "transition",
            beforeLifecycle: "development",
            afterLifecycle: "placed_on_market",
            originalPlacedOnMarketAt: null,
            correctedPlacedOnMarketAt: occurredAt,
            actorId: ids.owner,
            reason: null,
            correlationId: "66666666-6666-4666-8666-666666666666",
            occurredAt: "2026-08-12T10:15:30.000+00:00",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("parses the expanded release response and typed domain failures", () => {
    expect(
      releaseResponseSchema.parse({
        release: {
          id: releaseId,
          organizationId: ids.owner,
          productId: ids.entity,
          label: "Release candidate",
          version: "1.0.0",
          description: null,
          lifecycle: "placed_on_market",
          placedOnMarketAt: occurredAt,
          marketAvailabilityWarning: null,
          legalEntity: {
            id: ids.entity,
            identifier: "LE-001",
            legalName: "Example GmbH",
            mainEstablishmentCountry: "DE",
            version: 0,
          },
          archivedAt: null,
          versionNumber: 3,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          createdBy: ids.owner,
          updatedBy: ids.owner,
        },
      }),
    ).toMatchObject({
      release: {
        placedOnMarketAt: occurredAt,
        marketAvailabilityWarning: null,
      },
    });
    expect(
      releaseMarketLifecycleDomainErrorSchema.parse({
        code: "placement_requires_active_market_availability",
        message: "Add an active Member State before placement",
      }),
    ).toMatchObject({ code: "placement_requires_active_market_availability" });
    expect(
      releaseMarketLifecycleDomainErrorSchema.safeParse({
        code: "unknown_error",
      }).success,
    ).toBe(false);
    expect(
      releaseMarketLifecycleDomainErrorSchema.safeParse({
        code: "invalid_transition",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("exposes the exact release lifecycle state union", () => {
    expectTypeOf<ReleaseLifecycleState>().toEqualTypeOf<
      | "development"
      | "placed_on_market"
      | "in_support"
      | "end_of_support"
      | "withdrawn"
    >();
  });
});
