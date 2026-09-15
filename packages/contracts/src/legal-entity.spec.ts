import type {
  CreateLegalEntityInput,
  LegalEntity,
} from "./organizations/types/index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createLegalEntityInputSchema,
  legalEntityLifecycleInputSchema,
  legalEntityParamsSchema,
  legalEntitySchema,
  legalEntityVersionInputSchema,
  updateLegalEntityInputSchema,
} from "./organizations.js";

const entityId = "31111111-1111-4111-8111-111111111111";
const actorId = "32222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";

const legalEntityInput = {
  identifier: "  ACME-IRELAND  ",
  displayName: "  Acme Ireland  ",
  legalName: "  Acme Holdings Ireland Limited  ",
  registeredAddress: {
    addressLine1: "  1 Example Street  ",
    addressLine2: "Suite 4B",
    locality: "  Dublin  ",
    administrativeArea: "Leinster",
    postalCode: "D02 X285",
    country: "IE",
  },
  mainEstablishmentCountry: "IE",
  phone: "+35315551234",
  registrationIdentifier: "  ie\u00a0 123\u2003 456  ",
  taxIdentifier: "  vat\u00a0 ie\u2009 987 654  ",
  manufacturerContactName: "  Ada Manufacturer  ",
  manufacturerContactEmail: "  ADA.MANUFACTURER@EXAMPLE.COM  ",
  idempotencyKey,
};

const legalEntityUpdateInput = {
  identifier: legalEntityInput.identifier,
  displayName: legalEntityInput.displayName,
  legalName: legalEntityInput.legalName,
  registeredAddress: legalEntityInput.registeredAddress,
  mainEstablishmentCountry: legalEntityInput.mainEstablishmentCountry,
  phone: legalEntityInput.phone,
  registrationIdentifier: legalEntityInput.registrationIdentifier,
  taxIdentifier: legalEntityInput.taxIdentifier,
  manufacturerContactName: legalEntityInput.manufacturerContactName,
  manufacturerContactEmail: legalEntityInput.manufacturerContactEmail,
};

describe("legal-entity contracts", () => {
  it("strictly parses a create command and normalizes its identifier", () => {
    expect(createLegalEntityInputSchema.parse(legalEntityInput)).toEqual({
      ...legalEntityInput,
      identifier: "acme-ireland",
      displayName: "Acme Ireland",
      legalName: "Acme Holdings Ireland Limited",
      registrationIdentifier: "IE123456",
      taxIdentifier: "VATIE987654",
      manufacturerContactName: "Ada Manufacturer",
      manufacturerContactEmail: "ada.manufacturer@example.com",
      registeredAddress: {
        ...legalEntityInput.registeredAddress,
        addressLine1: "1 Example Street",
        locality: "Dublin",
      },
    });
  });

  it("normalizes optional registration and tax identifiers for collision checks", () => {
    const first = createLegalEntityInputSchema.parse(legalEntityInput);
    const second = createLegalEntityInputSchema.parse({
      ...legalEntityInput,
      registrationIdentifier: "ie123456",
      taxIdentifier: "vatie987654",
    });

    expect(first.registrationIdentifier).toBe("IE123456");
    expect(first.taxIdentifier).toBe("VATIE987654");
    expect(first.registrationIdentifier).toBe(second.registrationIdentifier);
    expect(first.taxIdentifier).toBe(second.taxIdentifier);
  });

  it.each([
    { ...legalEntityInput, identifier: "not an identifier" },
    { ...legalEntityInput, identifier: "123-acme" },
    { ...legalEntityInput, idempotencyKey: "not-a-uuid" },
    { ...legalEntityInput, unexpected: true },
    {
      ...legalEntityInput,
      registeredAddress: {
        ...legalEntityInput.registeredAddress,
        unexpected: true,
      },
    },
  ])("rejects non-strict or invalid create input %#", (value) => {
    expect(createLegalEntityInputSchema.safeParse(value).success).toBe(false);
  });

  it("requires a full replacement and optimistic version for updates", () => {
    expect(
      updateLegalEntityInputSchema.parse({
        ...legalEntityUpdateInput,
        expectedVersion: 2,
      }),
    ).toMatchObject({ identifier: "acme-ireland", expectedVersion: 2 });
    expect(
      updateLegalEntityInputSchema.safeParse({
        ...legalEntityUpdateInput,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
  });

  it("requires a versioned, strict lifecycle command", () => {
    expect(
      legalEntityLifecycleInputSchema.parse({
        expectedVersion: 2,
        status: "inactive",
      }),
    ).toEqual({ expectedVersion: 2, status: "inactive" });
    expect(
      legalEntityLifecycleInputSchema.safeParse({
        expectedVersion: 2,
        status: "archived",
      }).success,
    ).toBe(false);
  });

  it("strictly parses entity path and explicit lifecycle-action boundaries", () => {
    expect(legalEntityParamsSchema.parse({ legalEntityId: entityId })).toEqual({
      legalEntityId: entityId,
    });
    expect(legalEntityVersionInputSchema.parse({ expectedVersion: 2 })).toEqual(
      {
        expectedVersion: 2,
      },
    );
    expect(
      legalEntityParamsSchema.safeParse({
        legalEntityId: entityId,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      legalEntityVersionInputSchema.safeParse({
        expectedVersion: 2,
        status: "active",
      }).success,
    ).toBe(false);
  });

  it("exposes a strict complete active entity with lifecycle and version metadata", () => {
    const entity = {
      id: entityId,
      organizationId: "34444444-4444-4444-8444-444444444444",
      identifier: "acme-ireland",
      displayName: "Acme Ireland",
      legalName: "Acme Holdings Ireland Limited",
      registeredAddress: {
        addressLine1: "1 Example Street",
        addressLine2: "Suite 4B",
        locality: "Dublin",
        administrativeArea: "Leinster",
        postalCode: "D02 X285",
        country: "IE",
      },
      mainEstablishmentCountry: "IE",
      phone: "+35315551234",
      registrationIdentifier: "IE123456",
      taxIdentifier: "VATIE987654",
      manufacturerContactName: "Ada Manufacturer",
      manufacturerContactEmail: "ada.manufacturer@example.com",
      status: "active",
      completionStatus: "complete",
      isDefault: true,
      version: 2,
      dependencyProjections: [{ kind: "product", count: 0 }],
      createdAt: "2026-08-11T12:00:00.000Z",
      updatedAt: "2026-08-11T12:00:00.000Z",
      createdBy: actorId,
      updatedBy: actorId,
      deletedAt: null,
    } as const;

    expect(legalEntitySchema.parse(entity)).toEqual(entity);
    expect(
      legalEntitySchema.safeParse({
        ...entity,
        completionStatus: "needs_completion",
      }).success,
    ).toBe(false);
    expect(
      legalEntitySchema.safeParse({ ...entity, unexpected: true }).success,
    ).toBe(false);
    expectTypeOf(legalEntitySchema.parse).returns.toEqualTypeOf<LegalEntity>();
    expectTypeOf(
      createLegalEntityInputSchema.parse,
    ).returns.toEqualTypeOf<CreateLegalEntityInput>();
  });

  it("exposes an incomplete legacy default without inventing legal-profile data", () => {
    const legacyEntity = {
      id: entityId,
      organizationId: "34444444-4444-4444-8444-444444444444",
      identifier: null,
      displayName: "Legacy Acme",
      legalName: null,
      registeredAddress: null,
      mainEstablishmentCountry: null,
      phone: null,
      registrationIdentifier: null,
      taxIdentifier: null,
      manufacturerContactName: null,
      manufacturerContactEmail: null,
      status: "inactive",
      completionStatus: "needs_completion",
      isDefault: true,
      version: 0,
      dependencyProjections: [],
      createdAt: "2026-08-11T12:00:00.000Z",
      updatedAt: "2026-08-11T12:00:00.000Z",
      createdBy: actorId,
      updatedBy: actorId,
      deletedAt: null,
    } as const;

    expect(legalEntitySchema.parse(legacyEntity)).toEqual(legacyEntity);
    expect(
      legalEntitySchema.safeParse({ ...legacyEntity, status: "active" })
        .success,
    ).toBe(false);
  });
});
