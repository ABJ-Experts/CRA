import type {
  CreateOrganizationInput,
  OnboardingResponse,
  Organization,
  UpdateLegalProfileInput,
} from "@repo/contracts/organizations";

import { OrganizationUseCases } from "./organization-use-cases";
import type {
  CreateOrganizationAtomicOutcome,
  OrganizationRepository,
  SwitchOrganizationAtomicOutcome,
  UpdateLegalProfileAtomicOutcome,
} from "./organization-repository.port";
import { OrganizationRepositoryError } from "./organization-repository.port";

const actor = Object.freeze({
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@cra.test",
});
const organizationId = "00000000-0000-4000-8000-000000000002";
const legalProfileId = "00000000-0000-4000-8000-000000000003";
const idempotencyKey = "00000000-0000-4000-8000-000000000004";

const createInput = Object.freeze<CreateOrganizationInput>({
  legalName: "Acme Holdings Limited",
  registeredAddress: {
    addressLine1: "1 Example Street",
    locality: "London",
    postalCode: "SW1A 1AA",
    country: "GB",
  },
  mainEstablishmentCountry: "IE",
  phone: "+35315551234",
  manufacturerContactName: "Ada Manufacturer",
  manufacturerContactEmail: "ada.manufacturer@example.com",
  idempotencyKey,
});

const updateInput = Object.freeze<UpdateLegalProfileInput>({
  legalName: createInput.legalName,
  registeredAddress: createInput.registeredAddress,
  mainEstablishmentCountry: createInput.mainEstablishmentCountry,
  phone: createInput.phone,
  manufacturerContactName: createInput.manufacturerContactName,
  manufacturerContactEmail: createInput.manufacturerContactEmail,
  expectedVersion: 1,
});

const organization = Object.freeze<Organization>({
  id: organizationId,
  name: "Acme Holdings Limited",
  slug: "acme-holdings-limited",
  legalProfile: {
    id: legalProfileId,
    legalName: createInput.legalName,
    registeredAddress: createInput.registeredAddress,
    mainEstablishmentCountry: createInput.mainEstablishmentCountry,
    phone: createInput.phone ?? null,
    manufacturerContactName: createInput.manufacturerContactName,
    manufacturerContactEmail: createInput.manufacturerContactEmail,
    version: 1,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    createdBy: actor.id,
    updatedBy: actor.id,
  },
});

const onboarding = Object.freeze<OnboardingResponse>({
  organization,
  stages: [
    {
      stage: "organization_details",
      status: "completed",
      resourceIds: [organizationId],
      unavailableResourceIds: [],
      completedAt: "2026-08-10T00:00:00.000Z",
      actorId: actor.id,
      blockReason: null,
    },
    {
      stage: "first_product",
      status: "pending",
      resourceIds: [],
      unavailableResourceIds: [],
      completedAt: null,
      actorId: null,
      blockReason: null,
    },
    {
      stage: "first_sbom",
      status: "blocked",
      resourceIds: [],
      unavailableResourceIds: [],
      completedAt: null,
      actorId: null,
      blockReason: "awaiting_authoritative_product",
    },
    {
      stage: "invite_team",
      status: "blocked",
      resourceIds: [],
      unavailableResourceIds: [],
      completedAt: null,
      actorId: null,
      blockReason: "awaiting_prior_stage",
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
  blocked: false,
  integrationAvailability: { products: false, sbom: false, invitations: true },
});

class OrganizationRepositoryFake implements OrganizationRepository {
  readonly calls: Array<
    Readonly<{ operation: string; args: readonly unknown[] }>
  > = [];
  createOutcome: CreateOrganizationAtomicOutcome = {
    outcome: "created",
    organization,
  };
  updateOutcome: UpdateLegalProfileAtomicOutcome = {
    outcome: "updated",
    organization,
  };
  switchOutcome: SwitchOrganizationAtomicOutcome = {
    outcome: "switched",
    organization,
  };
  current: Organization | null = organization;
  onboarding: OnboardingResponse | null = onboarding;
  isMember = true;
  failure: Error | OrganizationRepositoryError | null = null;

  createAtomic(
    userId: string,
    input: CreateOrganizationInput,
  ): Promise<CreateOrganizationAtomicOutcome> {
    this.record("createAtomic", userId, input);
    this.throwFailure();
    return Promise.resolve(this.createOutcome);
  }

  currentForMember(
    orgId: string,
    userId: string,
  ): Promise<Organization | null> {
    this.record("currentForMember", orgId, userId);
    this.throwFailure();
    return Promise.resolve(this.current);
  }

  updateLegalProfileAtomic(
    orgId: string,
    userId: string,
    input: UpdateLegalProfileInput,
  ): Promise<UpdateLegalProfileAtomicOutcome> {
    this.record("updateLegalProfileAtomic", orgId, userId, input);
    this.throwFailure();
    return Promise.resolve(this.updateOutcome);
  }

  onboardingForMember(
    orgId: string,
    userId: string,
  ): Promise<OnboardingResponse | null> {
    this.record("onboardingForMember", orgId, userId);
    this.throwFailure();
    return Promise.resolve(this.onboarding);
  }

  switchAtomic(
    orgId: string,
    userId: string,
  ): Promise<SwitchOrganizationAtomicOutcome> {
    this.record("switchAtomic", orgId, userId);
    this.throwFailure();
    return Promise.resolve(this.switchOutcome);
  }

  verifyMembership(orgId: string, userId: string): Promise<boolean> {
    this.record("verifyMembership", orgId, userId);
    this.throwFailure();
    return Promise.resolve(this.isMember);
  }

  private record(operation: string, ...args: readonly unknown[]): void {
    this.calls.push(Object.freeze({ operation, args: Object.freeze(args) }));
  }

  private throwFailure(): void {
    if (this.failure) throw this.failure;
  }
}

function fixture() {
  const repository = new OrganizationRepositoryFake();
  return {
    repository,
    useCases: new OrganizationUseCases(repository),
  };
}

describe("OrganizationUseCases", () => {
  it("creates only through the atomic repository and returns its committed organization", async () => {
    const { repository, useCases } = fixture();

    await expect(
      useCases.create({ actor, input: createInput }),
    ).resolves.toEqual({
      ok: true,
      value: organization,
    });
    expect(repository.calls).toEqual([
      { operation: "createAtomic", args: [actor.id, createInput] },
    ]);
  });

  it.each([
    ["idempotency_mismatch", "idempotency_mismatch"],
    ["legal_identity_conflict", "legal_identity_conflict"],
    ["user_not_found", "create_failed"],
  ] as const)(
    "maps atomic creation %s without leaking provider detail",
    async (outcome, code) => {
      const { repository, useCases } = fixture();
      repository.createOutcome = { outcome };

      await expect(
        useCases.create({ actor, input: createInput }),
      ).resolves.toEqual({
        ok: false,
        error: { code },
      });
    },
  );

  it("returns a nullable current organization without querying when the caller has no membership", async () => {
    const { repository, useCases } = fixture();

    await expect(
      useCases.current({ organizationId: null, userId: actor.id }),
    ).resolves.toEqual({ ok: true, value: null });
    expect(repository.calls).toEqual([]);
  });

  it("contains an atomic-create provider failure", async () => {
    const { repository, useCases } = fixture();
    repository.failure = new Error("create provider unavailable");

    await expect(
      useCases.create({ actor, input: createInput }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "provider_unavailable" },
    });
  });

  it("looks up the current organization with organization scope first", async () => {
    const { repository, useCases } = fixture();

    await expect(
      useCases.current({ organizationId, userId: actor.id }),
    ).resolves.toEqual({ ok: true, value: organization });
    expect(repository.calls).toEqual([
      { operation: "currentForMember", args: [organizationId, actor.id] },
    ]);
  });

  it("uses an optimistic full-profile replacement and maps a stale version", async () => {
    const { repository, useCases } = fixture();
    repository.updateOutcome = { outcome: "version_conflict" };

    await expect(
      useCases.updateLegalProfile({
        organizationId,
        actor,
        input: updateInput,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "version_conflict" } });
    expect(repository.calls).toEqual([
      {
        operation: "updateLegalProfileAtomic",
        args: [organizationId, actor.id, updateInput],
      },
    ]);
  });

  it("maps a legal-identity collision during profile replacement", async () => {
    const { repository, useCases } = fixture();
    repository.updateOutcome = { outcome: "legal_identity_conflict" };

    await expect(
      useCases.updateLegalProfile({
        organizationId,
        actor,
        input: updateInput,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "legal_identity_conflict" },
    });
  });

  it.each([
    [
      { outcome: "updated", organization },
      { ok: true, value: organization },
    ],
    [
      { outcome: "not_found" },
      { ok: false, error: { code: "organization_not_found" } },
    ],
  ] as const)("maps profile outcome %#", async (outcome, expected) => {
    const { repository, useCases } = fixture();
    repository.updateOutcome = outcome;

    await expect(
      useCases.updateLegalProfile({
        organizationId,
        actor,
        input: updateInput,
      }),
    ).resolves.toEqual(expected);
  });

  it("contains a legal-profile provider failure", async () => {
    const { repository, useCases } = fixture();
    repository.failure = new Error("update provider unavailable");

    await expect(
      useCases.updateLegalProfile({
        organizationId,
        actor,
        input: updateInput,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "provider_unavailable" },
    });
  });

  it("does not query onboarding without an active organization", async () => {
    const { repository, useCases } = fixture();

    await expect(
      useCases.onboarding({ organizationId: null, userId: actor.id }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "no_active_organization" },
    });
    expect(repository.calls).toEqual([]);
  });

  it("returns a detached onboarding snapshot and maps a tenant-safe absence", async () => {
    const { repository, useCases } = fixture();

    const result = await useCases.onboarding({
      organizationId,
      userId: actor.id,
    });
    expect(result).toEqual({ ok: true, value: onboarding });
    if (!result.ok) throw new Error("Expected onboarding success");
    expect(result.value).not.toBe(onboarding);
    expect(result.value.organization).not.toBe(onboarding.organization);
    expect(result.value.stages).not.toBe(onboarding.stages);
    expect(result.value.stages[0].resourceIds).not.toBe(
      onboarding.stages[0].resourceIds,
    );
    expect(result.value.stages[0].unavailableResourceIds).not.toBe(
      onboarding.stages[0].unavailableResourceIds,
    );

    repository.onboarding = null;
    await expect(
      useCases.onboarding({ organizationId, userId: actor.id }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "organization_not_found" },
    });
  });

  it("contains an onboarding provider failure", async () => {
    const { repository, useCases } = fixture();
    repository.failure = new Error("onboarding provider unavailable");

    await expect(
      useCases.onboarding({ organizationId, userId: actor.id }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "provider_unavailable" },
    });
  });

  it("switches through the atomic membership-and-audit repository operation", async () => {
    const { repository, useCases } = fixture();

    await expect(useCases.switch({ organizationId, actor })).resolves.toEqual({
      ok: true,
      value: organization,
    });
    expect(repository.calls).toEqual([
      { operation: "switchAtomic", args: [organizationId, actor.id] },
    ]);
  });

  it("returns tenant-safe missing switch target from the atomic outcome", async () => {
    const { repository, useCases } = fixture();
    repository.switchOutcome = { outcome: "not_found" };

    await expect(useCases.switch({ organizationId, actor })).resolves.toEqual({
      ok: false,
      error: { code: "organization_not_found" },
    });
  });

  it("contains a switch provider failure", async () => {
    const { repository, useCases } = fixture();
    repository.failure = new Error("switch provider unavailable");

    await expect(useCases.switch({ organizationId, actor })).resolves.toEqual({
      ok: false,
      error: { code: "provider_unavailable" },
    });
  });

  it("re-exposes the post-RPC membership verification needed before a cookie write", async () => {
    const { repository, useCases } = fixture();

    await expect(
      useCases.verifyMembership(organizationId, actor.id),
    ).resolves.toEqual({
      ok: true,
      value: true,
    });
    expect(repository.calls).toEqual([
      { operation: "verifyMembership", args: [organizationId, actor.id] },
    ]);
  });

  it("contains a membership-verification provider failure", async () => {
    const { repository, useCases } = fixture();
    repository.failure = new Error("membership provider unavailable");

    await expect(
      useCases.verifyMembership(organizationId, actor.id),
    ).resolves.toEqual({
      ok: false,
      error: { code: "provider_unavailable" },
    });
  });

  it("contains provider failure as a stable application error", async () => {
    const { repository, useCases } = fixture();
    repository.failure = new Error("provider says private details");

    await expect(
      useCases.current({ organizationId, userId: actor.id }),
    ).resolves.toEqual({ ok: false, error: { code: "provider_unavailable" } });
  });

  it("distinguishes malformed provider data without exposing it", async () => {
    const { repository, useCases } = fixture();
    repository.failure = new OrganizationRepositoryError("malformed");

    await expect(
      useCases.current({ organizationId, userId: actor.id }),
    ).resolves.toEqual({ ok: false, error: { code: "malformed_provider" } });
  });
});
