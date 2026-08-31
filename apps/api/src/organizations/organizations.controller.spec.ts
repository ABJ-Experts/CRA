import type {
  CreateOrganizationInput,
  Organization,
  UpdateLegalProfileInput,
} from "@repo/contracts/organizations";

import type { RequestUser } from "../auth/auth.types";
import { unsign } from "../auth/cookies.util";
import { OrganizationsController } from "./organizations.controller";

const organizationId = "00000000-0000-4000-8000-000000000002";
const user: RequestUser = Object.freeze({
  id: "00000000-0000-4000-8000-000000000001",
  authUserId: "00000000-0000-4000-8000-000000000010",
  email: "owner@cra.test",
  isActive: true,
  organizationId,
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
});
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
  const organizations = {
    create: jest.fn().mockResolvedValue(organization),
    current: jest.fn().mockResolvedValue(organization),
    updateLegalProfile: jest.fn().mockResolvedValue(organization),
    onboarding: jest.fn().mockResolvedValue({ organization }),
    switch: jest.fn().mockResolvedValue(organization),
    verifyMembership: jest.fn().mockResolvedValue(true),
  };
  const response = {
    cookie: jest.fn<void, [string, string, unknown]>(),
  };
  const signingSecret = "organization-controller-test-signing-secret";
  return {
    controller: new OrganizationsController(
      organizations as never,
      {
        get: jest.fn((key: string) =>
          key === "COOKIE_DOMAIN"
            ? ""
            : key === "COOKIE_SECURE"
              ? false
              : key === "COOKIE_SAMESITE"
                ? "lax"
                : undefined,
        ),
        getOrThrow: jest.fn((key: string) =>
          key === "ACCESS_TOKEN_MAX_AGE"
            ? 3600
            : key === "REFRESH_TOKEN_MAX_AGE"
              ? 604800
              : key === "COOKIE_SIGNING_SECRET"
                ? signingSecret
                : undefined,
        ),
      } as never,
    ),
    organizations,
    response,
    signingSecret,
  };
}

describe("OrganizationsController", () => {
  it("uses the existing secure cookie defaults when optional configuration is absent", async () => {
    const { organizations } = fixture();
    const controller = new OrganizationsController(
      organizations as never,
      {
        get: jest.fn().mockReturnValue(undefined),
        getOrThrow: jest.fn((key: string) =>
          key === "ACCESS_TOKEN_MAX_AGE"
            ? 3600
            : key === "REFRESH_TOKEN_MAX_AGE"
              ? 604800
              : "organization-controller-test-signing-secret",
        ),
      } as never,
    );

    await expect(controller.current(user)).resolves.toEqual({ organization });
  });

  it("creates only as the authenticated identity", async () => {
    const { controller, organizations, response, signingSecret } = fixture();

    await expect(
      controller.create(createInput, user, response as never),
    ).resolves.toBe(organization);
    expect(organizations.create).toHaveBeenCalledWith(
      { id: user.id, email: user.email },
      createInput,
    );
    expect(organizations.verifyMembership).toHaveBeenCalledWith(
      organizationId,
      user.id,
    );
    const signedOrganization = response.cookie.mock.calls[0]?.[1];
    if (!signedOrganization)
      throw new Error("Expected active organization cookie");
    expect(unsign(signedOrganization, signingSecret)).toBe(organizationId);
  });

  it("returns a nullable current organization without a client-provided tenant", async () => {
    const { controller, organizations } = fixture();
    const unscoped = { ...user, organizationId: null };
    organizations.current.mockResolvedValueOnce(null);

    await expect(controller.current(unscoped)).resolves.toEqual({
      organization: null,
    });
    expect(organizations.current).toHaveBeenCalledWith(null, user.id);
  });

  it("updates the active organization with the signed-in actor and complete profile", async () => {
    const { controller, organizations } = fixture();

    await expect(
      controller.updateLegalProfile(updateInput, user),
    ).resolves.toBe(organization);
    expect(organizations.updateLegalProfile).toHaveBeenCalledWith(
      organizationId,
      { id: user.id, email: user.email },
      updateInput,
    );
  });

  it("loads onboarding only for the guard-selected active organization", async () => {
    const { controller, organizations } = fixture();

    await expect(controller.onboarding(user)).resolves.toEqual({
      organization,
    });
    expect(organizations.onboarding).toHaveBeenCalledWith(
      organizationId,
      user.id,
    );
  });

  it("returns the tenant-safe not-found shape when onboarding has no active organization", async () => {
    const { controller, organizations } = fixture();
    const unscoped = { ...user, organizationId: null };

    await expect(controller.onboarding(unscoped)).rejects.toMatchObject({
      response: {
        message: "Organization not found.",
        code: "organization_not_found",
      },
    });
    expect(organizations.onboarding).not.toHaveBeenCalled();
  });

  it("switches only the signed-in caller and wraps the response contract", async () => {
    const { controller, organizations, response } = fixture();

    await expect(
      controller.switch({ organizationId }, user, response as never),
    ).resolves.toEqual({ organization });
    expect(organizations.switch).toHaveBeenCalledWith(organizationId, {
      id: user.id,
      email: user.email,
    });
    expect(organizations.verifyMembership).toHaveBeenCalledWith(
      organizationId,
      user.id,
    );
  });

  it("does not set an active-org cookie if the committed membership cannot be re-read", async () => {
    const { controller, organizations, response } = fixture();
    organizations.verifyMembership.mockResolvedValue(false);

    await expect(
      controller.create(createInput, user, response as never),
    ).rejects.toMatchObject({ response: { code: "organization_not_found" } });
    expect(response.cookie).not.toHaveBeenCalled();
  });
});
