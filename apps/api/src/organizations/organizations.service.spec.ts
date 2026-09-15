import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  CreateOrganizationInput,
  Organization,
  UpdateLegalProfileInput,
} from "@repo/contracts/organizations";

import type { OrganizationUseCaseError } from "./application/organization-use-cases";
import { OrganizationsService } from "./organizations.service";

const actor = Object.freeze({
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@cra.test",
});
const organizationId = "00000000-0000-4000-8000-000000000002";
const organization = Object.freeze<Organization>({
  id: organizationId,
  name: "Acme Holdings Limited",
  slug: "acme-holdings-limited",
  legalProfile: null,
});
const createInput = Object.freeze<CreateOrganizationInput>({
  legalName: "Acme Holdings Limited",
  registeredAddress: {
    addressLine1: "1 Example Street",
    locality: "London",
    postalCode: "SW1A 1AA",
    country: "GB",
  },
  mainEstablishmentCountry: "IE",
  manufacturerContactName: "Ada Manufacturer",
  manufacturerContactEmail: "ada.manufacturer@example.com",
  idempotencyKey: "00000000-0000-4000-8000-000000000004",
});
const updateInput = Object.freeze<UpdateLegalProfileInput>({
  legalName: createInput.legalName,
  registeredAddress: createInput.registeredAddress,
  mainEstablishmentCountry: createInput.mainEstablishmentCountry,
  manufacturerContactName: createInput.manufacturerContactName,
  manufacturerContactEmail: createInput.manufacturerContactEmail,
  expectedVersion: 1,
});

function fixture() {
  const useCases = {
    create: jest.fn().mockResolvedValue({ ok: true, value: organization }),
    current: jest.fn().mockResolvedValue({ ok: true, value: organization }),
    updateLegalProfile: jest
      .fn()
      .mockResolvedValue({ ok: true, value: organization }),
    onboarding: jest
      .fn()
      .mockResolvedValue({ ok: true, value: { organization } }),
    switch: jest.fn().mockResolvedValue({ ok: true, value: organization }),
    verifyMembership: jest.fn().mockResolvedValue({ ok: true, value: true }),
  };
  return { service: new OrganizationsService(useCases as never), useCases };
}

describe("OrganizationsService", () => {
  it("keeps controllers on a framework-compatible facade", async () => {
    const { service, useCases } = fixture();

    await expect(service.create(actor, createInput)).resolves.toBe(
      organization,
    );
    await expect(service.current(null, actor.id)).resolves.toBe(organization);
    await expect(
      service.updateLegalProfile(organizationId, actor, updateInput),
    ).resolves.toBe(organization);
    await expect(service.onboarding(organizationId, actor.id)).resolves.toEqual(
      {
        organization,
      },
    );
    await expect(service.switch(organizationId, actor)).resolves.toBe(
      organization,
    );
    await expect(
      service.verifyMembership(organizationId, actor.id),
    ).resolves.toBe(true);

    expect(useCases.create).toHaveBeenCalledWith({ actor, input: createInput });
    expect(useCases.current).toHaveBeenCalledWith({
      organizationId: null,
      userId: actor.id,
    });
    expect(useCases.updateLegalProfile).toHaveBeenCalledWith({
      organizationId,
      actor,
      input: updateInput,
    });
    expect(useCases.onboarding).toHaveBeenCalledWith({
      organizationId,
      userId: actor.id,
    });
    expect(useCases.switch).toHaveBeenCalledWith({ organizationId, actor });
    expect(useCases.verifyMembership).toHaveBeenCalledWith(
      organizationId,
      actor.id,
    );
  });

  it.each([
    ["idempotency_mismatch", ConflictException, "idempotency_mismatch"],
    ["legal_identity_conflict", ConflictException, "legal_identity_conflict"],
    ["version_conflict", ConflictException, "version_conflict"],
    ["organization_not_found", NotFoundException, "organization_not_found"],
    ["no_active_organization", NotFoundException, "organization_not_found"],
    ["create_failed", BadRequestException, "create_failed"],
    ["update_failed", BadRequestException, "update_failed"],
    ["onboarding_failed", BadRequestException, "onboarding_failed"],
    [
      "provider_unavailable",
      ServiceUnavailableException,
      "organization_unavailable",
    ],
    [
      "malformed_provider",
      InternalServerErrorException,
      "organization_provider_invalid",
    ],
  ] as const)(
    "maps %s to a stable HTTP error without provider data",
    async (code, Exception, responseCode) => {
      const { service, useCases } = fixture();
      const error: OrganizationUseCaseError = { code };
      useCases.create.mockResolvedValue({ ok: false, error });

      const promise = service.create(actor, createInput);
      await expect(promise).rejects.toBeInstanceOf(Exception);
      await expect(promise).rejects.toMatchObject({
        response: { code: responseCode },
      });
      await expect(promise).rejects.not.toThrow(
        "provider says private details",
      );
    },
  );
});
