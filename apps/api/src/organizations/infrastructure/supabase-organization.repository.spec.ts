import type {
  CreateOrganizationInput,
  UpdateLegalProfileInput,
} from "@repo/contracts/organizations";

import { contactAuditDigest } from "./legal-profile-audit-digest";
import { SupabaseOrganizationRepository } from "./supabase-organization.repository";

interface ProviderResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

type ProviderRpcMock = jest.Mock<
  Promise<ProviderResult>,
  [string, Readonly<Record<string, unknown>>]
>;
type ProviderFromMock = jest.Mock<ReturnType<typeof providerQuery>, [string]>;

interface Harness {
  readonly from: ProviderFromMock;
  readonly queries: Array<ReturnType<typeof providerQuery>>;
  readonly repository: SupabaseOrganizationRepository;
  readonly rpc: ProviderRpcMock;
  readonly signingSecret: string;
}

function providerQuery(result: ProviderResult) {
  const chain = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    maybeSingle: jest.fn(),
    then: undefined as unknown as PromiseLike<ProviderResult>["then"],
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  chain.then = ((resolve: (value: ProviderResult) => unknown) =>
    Promise.resolve(result).then(
      resolve,
    )) as PromiseLike<ProviderResult>["then"];
  return chain;
}

function harness(
  queryResults: readonly ProviderResult[],
  rpcResults: readonly ProviderResult[],
): Harness {
  const queries: Array<ReturnType<typeof providerQuery>> = [];
  const from = jest.fn<ReturnType<typeof providerQuery>, [string]>();
  from.mockImplementation(() => {
    const result = queryResults[queries.length];
    if (!result) throw new Error("Missing query fixture");
    const query = providerQuery(result);
    queries.push(query);
    return query;
  });
  let rpcIndex = 0;
  const rpc = jest.fn<
    Promise<ProviderResult>,
    [string, Readonly<Record<string, unknown>>]
  >();
  rpc.mockImplementation(() => {
    const result = rpcResults[rpcIndex++];
    if (!result) throw new Error("Missing RPC fixture");
    return Promise.resolve(result);
  });
  const signingSecret = "a-test-signing-secret-that-is-long-enough";
  const repository = new SupabaseOrganizationRepository(
    { admin: () => ({ from, rpc }) } as never,
    {
      getOrThrow: <T>() => signingSecret as T,
    } as never,
  );
  return { from, queries, repository, rpc, signingSecret };
}

const actorId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const profileId = "00000000-0000-4000-8000-000000000003";
const productId = "00000000-0000-4000-8000-000000000005";
const input = Object.freeze<CreateOrganizationInput>({
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
const profileRow = Object.freeze({
  id: profileId,
  organization_id: organizationId,
  legal_name: input.legalName,
  registered_address_line_1: input.registeredAddress.addressLine1,
  registered_address_line_2: null,
  registered_address_locality: input.registeredAddress.locality,
  registered_address_administrative_area: null,
  registered_address_postal_code: input.registeredAddress.postalCode,
  registered_address_country: input.registeredAddress.country,
  main_establishment_country: input.mainEstablishmentCountry,
  manufacturer_contact_name: input.manufacturerContactName,
  manufacturer_contact_email: input.manufacturerContactEmail,
  manufacturer_contact_phone: null,
  version: 1,
  created_at: "2026-08-10T00:00:00.000Z",
  updated_at: "2026-08-10T00:00:00.000Z",
  created_by: actorId,
  updated_by: actorId,
});
const organizationRow = Object.freeze({
  id: organizationId,
  name: input.legalName,
  slug: "acme-holdings-limited",
});

function currentQueryResults(): readonly ProviderResult[] {
  return [
    { data: { id: "membership-1" }, error: null },
    { data: organizationRow, error: null },
    { data: profileRow, error: null },
  ];
}

describe("SupabaseOrganizationRepository", () => {
  it("creates through one atomic RPC, then exposes only the committed organization", async () => {
    const { queries, repository, rpc } = harness(currentQueryResults(), [
      {
        data: [{ outcome: "created", organization_id: organizationId }],
        error: null,
      },
    ]);

    await expect(
      repository.createAtomic(actorId, input),
    ).resolves.toMatchObject({
      outcome: "created",
      organization: {
        id: organizationId,
        legalProfile: { id: profileId, phone: null },
      },
    });
    expect(rpc).toHaveBeenCalledWith("create_organization_atomic", {
      p_actor_user_id: actorId,
      p_idempotency_key: input.idempotencyKey,
      p_legal_name: input.legalName,
      p_address_line_1: input.registeredAddress.addressLine1,
      p_address_line_2: null,
      p_locality: input.registeredAddress.locality,
      p_administrative_area: null,
      p_postal_code: input.registeredAddress.postalCode,
      p_registered_address_country: input.registeredAddress.country,
      p_main_establishment_country: input.mainEstablishmentCountry,
      p_manufacturer_contact_name: input.manufacturerContactName,
      p_manufacturer_contact_email: input.manufacturerContactEmail,
      p_manufacturer_contact_phone: null,
    });
    expect(queries[0]?.eq).toHaveBeenNthCalledWith(
      1,
      "organization_id",
      organizationId,
    );
    expect(queries[0]?.eq).toHaveBeenNthCalledWith(2, "user_id", actorId);
    expect(queries[1]?.eq).toHaveBeenCalledWith("id", organizationId);
    expect(queries[2]?.eq).toHaveBeenCalledWith(
      "organization_id",
      organizationId,
    );
  });

  it.each([
    ["idempotency_mismatch"],
    ["legal_identity_conflict"],
    ["user_not_found"],
  ] as const)(
    "passes through a stable create outcome %s without a follow-up read",
    async (outcome) => {
      const { from, repository } = harness(
        [],
        [{ data: [{ outcome }], error: null }],
      );

      await expect(repository.createAtomic(actorId, input)).resolves.toEqual({
        outcome,
      });
      expect(from).not.toHaveBeenCalled();
    },
  );

  it("returns no current organization without reading unscoped organization data", async () => {
    const { from, queries, repository } = harness(
      [{ data: null, error: null }],
      [],
    );

    await expect(
      repository.currentForMember(organizationId, actorId),
    ).resolves.toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
    expect(queries[0]?.eq).toHaveBeenNthCalledWith(
      1,
      "organization_id",
      organizationId,
    );
    expect(queries[0]?.eq).toHaveBeenNthCalledWith(2, "user_id", actorId);
  });

  it("keeps legacy organizations visible with a null legal profile", async () => {
    const { repository } = harness(
      [
        { data: { id: "membership-1" }, error: null },
        { data: organizationRow, error: null },
        { data: null, error: null },
      ],
      [],
    );

    await expect(
      repository.currentForMember(organizationId, actorId),
    ).resolves.toEqual({
      id: organizationId,
      name: input.legalName,
      slug: "acme-holdings-limited",
      legalProfile: null,
    });
  });

  it("does not reveal an organization when the scoped organization reread is absent", async () => {
    const { repository } = harness(
      [
        { data: { id: "membership-1" }, error: null },
        { data: null, error: null },
      ],
      [],
    );

    await expect(
      repository.currentForMember(organizationId, actorId),
    ).resolves.toBeNull();
  });

  it("sends only domain-separated contact digests in the update audit arguments", async () => {
    const update: UpdateLegalProfileInput = {
      ...input,
      manufacturerContactName: "Grace Manufacturer",
      manufacturerContactEmail: "grace.manufacturer@example.com",
      phone: "+35315551234",
      expectedVersion: 1,
    };
    const { repository, rpc, signingSecret } = harness(
      [...currentQueryResults(), ...currentQueryResults()],
      [{ data: [{ outcome: "updated" }], error: null }],
    );

    await expect(
      repository.updateLegalProfileAtomic(organizationId, actorId, update),
    ).resolves.toMatchObject({
      outcome: "updated",
      organization: { id: organizationId },
    });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(rpc.mock.calls[0]?.[0]).toBe(
      "update_organization_legal_profile_atomic",
    );
    expect(args).toMatchObject({
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_expected_version: 1,
      p_contact_name_before_digest: contactAuditDigest(
        "manufacturer_contact_name",
        input.manufacturerContactName,
        signingSecret,
      ),
      p_contact_name_after_digest: contactAuditDigest(
        "manufacturer_contact_name",
        update.manufacturerContactName,
        signingSecret,
      ),
      p_contact_email_before_digest: contactAuditDigest(
        "manufacturer_contact_email",
        input.manufacturerContactEmail,
        signingSecret,
      ),
      p_contact_phone_before_digest: contactAuditDigest(
        "manufacturer_contact_phone",
        null,
        signingSecret,
      ),
      p_contact_phone_after_digest: contactAuditDigest(
        "manufacturer_contact_phone",
        update.phone ?? null,
        signingSecret,
      ),
    });
    expect(String(args.p_contact_name_after_digest)).not.toContain("Grace");
    expect(String(args.p_contact_email_after_digest)).not.toContain("grace");
  });

  it("allows a version-zero full replacement to create a missing legacy profile", async () => {
    const update: UpdateLegalProfileInput = {
      ...input,
      expectedVersion: 0,
    };
    const { repository, rpc, signingSecret } = harness(
      [
        ...currentQueryResults().slice(0, 2),
        { data: null, error: null },
        ...currentQueryResults(),
      ],
      [{ data: [{ outcome: "updated" }], error: null }],
    );

    await expect(
      repository.updateLegalProfileAtomic(organizationId, actorId, update),
    ).resolves.toMatchObject({ outcome: "updated" });
    const rpcCall = rpc.mock.calls[0];
    if (!rpcCall) throw new Error("Expected a legacy update RPC call");
    expect(rpcCall[1]).toMatchObject({
      p_expected_version: 0,
      p_contact_name_before_digest: contactAuditDigest(
        "manufacturer_contact_name",
        null,
        signingSecret,
      ),
      p_contact_email_before_digest: contactAuditDigest(
        "manufacturer_contact_email",
        null,
        signingSecret,
      ),
      p_contact_phone_before_digest: contactAuditDigest(
        "manufacturer_contact_phone",
        null,
        signingSecret,
      ),
    });
  });

  it("reads ordered stages and scoped evidence into a contract-valid onboarding snapshot", async () => {
    const { queries, repository } = harness(
      [
        ...currentQueryResults(),
        {
          data: [
            {
              stage: "organization_details",
              status: "completed",
              completed_at: "2026-08-10T00:00:00.000Z",
              completed_by: actorId,
              block_reason: null,
              stage_order: 1,
            },
            {
              stage: "first_product",
              status: "blocked",
              completed_at: null,
              completed_by: null,
              block_reason: "awaiting_authoritative_product",
              stage_order: 2,
            },
            {
              stage: "first_sbom",
              status: "blocked",
              completed_at: null,
              completed_by: null,
              block_reason: "awaiting_prior_stage",
              stage_order: 3,
            },
            {
              stage: "invite_team",
              status: "blocked",
              completed_at: null,
              completed_by: null,
              block_reason: "awaiting_prior_stage",
              stage_order: 4,
            },
            {
              stage: "completed",
              status: "blocked",
              completed_at: null,
              completed_by: null,
              block_reason: "awaiting_prior_stage",
              stage_order: 5,
            },
          ],
          error: null,
        },
        {
          data: [
            {
              stage: "first_product",
              resource_id: productId,
              is_available: true,
            },
            {
              stage: "first_sbom",
              resource_id: "00000000-0000-4000-8000-000000000006",
              is_available: false,
            },
          ],
          error: null,
        },
      ],
      [],
    );

    const result = await repository.onboardingForMember(
      organizationId,
      actorId,
    );
    expect(result).toMatchObject({
      organization: { id: organizationId },
      nextIncompleteStage: "first_product",
      blocked: true,
      integrationAvailability: {
        products: false,
        sbom: false,
        invitations: true,
      },
    });
    expect(result?.stages.slice(0, 3)).toMatchObject([
      {
        stage: "organization_details",
        resourceIds: [organizationId],
        unavailableResourceIds: [],
      },
      {
        stage: "first_product",
        resourceIds: [productId],
        unavailableResourceIds: [],
      },
      {
        stage: "first_sbom",
        resourceIds: [],
        unavailableResourceIds: ["00000000-0000-4000-8000-000000000006"],
      },
    ]);
    expect(queries[3]?.order).toHaveBeenCalledWith("stage_order", {
      ascending: true,
    });
    expect(queries[4]?.eq).toHaveBeenCalledWith(
      "organization_id",
      organizationId,
    );
  });

  it("switches through the atomic membership-and-audit RPC before reading the result", async () => {
    const { repository, rpc } = harness(currentQueryResults(), [
      { data: [{ outcome: "switched" }], error: null },
    ]);

    await expect(
      repository.switchAtomic(organizationId, actorId),
    ).resolves.toMatchObject({
      outcome: "switched",
      organization: { id: organizationId },
    });
    expect(rpc).toHaveBeenCalledWith("switch_organization_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
    });
  });

  it("fails closed when onboarding evidence has a non-boolean availability flag", async () => {
    const { repository } = harness(
      [
        ...currentQueryResults(),
        {
          data: [
            {
              stage: "organization_details",
              status: "completed",
              completed_at: "2026-08-10T00:00:00.000Z",
              completed_by: actorId,
              block_reason: null,
              stage_order: 1,
            },
          ],
          error: null,
        },
        {
          data: [
            {
              stage: "first_product",
              resource_id: productId,
              is_available: "true",
            },
          ],
          error: null,
        },
      ],
      [],
    );

    await expect(
      repository.onboardingForMember(organizationId, actorId),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it.each([["not_found"]] as const)(
    "does not follow up a switch outcome %s",
    async (outcome) => {
      const { from, repository } = harness(
        [],
        [{ data: [{ outcome }], error: null }],
      );

      await expect(
        repository.switchAtomic(organizationId, actorId),
      ).resolves.toEqual({
        outcome,
      });
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["not_found"],
    ["version_conflict"],
    ["legal_identity_conflict"],
  ] as const)(
    "preserves update outcome %s without a committed reread",
    async (outcome) => {
      const { from, repository } = harness(currentQueryResults(), [
        { data: [{ outcome }], error: null },
      ]);

      await expect(
        repository.updateLegalProfileAtomic(organizationId, actorId, {
          ...input,
          expectedVersion: 1,
        }),
      ).resolves.toEqual({ outcome });
      expect(from).toHaveBeenCalledTimes(3);
    },
  );

  it("contains transport failures without retaining the provider message", async () => {
    const { repository } = harness(
      [],
      [{ data: null, error: { message: "private database outage" } }],
    );

    await expect(repository.createAtomic(actorId, input)).rejects.toMatchObject(
      {
        code: "unavailable",
      },
    );
  });

  it("maps a bad provider response to a stable malformed failure", async () => {
    const { repository } = harness(
      [],
      [
        {
          data: [{ outcome: "the-provider-added-a-secret-mode" }],
          error: null,
        },
      ],
    );

    await expect(repository.createAtomic(actorId, input)).rejects.toMatchObject(
      {
        code: "malformed",
      },
    );
  });
});
