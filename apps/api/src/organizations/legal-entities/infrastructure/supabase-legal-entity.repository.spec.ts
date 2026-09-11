import type {
  CreateLegalEntityInput,
  LegalEntity,
  UpdateLegalEntityInput,
} from "@repo/contracts/organizations";

import { SupabaseLegalEntityRepository } from "./supabase-legal-entity.repository";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const entityId = "00000000-0000-4000-8000-000000000003";
const idempotencyKey = "00000000-0000-4000-8000-000000000004";
const legalEntity: LegalEntity = {
  id: entityId,
  organizationId,
  identifier: "acme-us",
  displayName: "Acme US",
  legalName: "Acme US LLC",
  registeredAddress: {
    addressLine1: "1 Market Street",
    locality: "San Francisco",
    postalCode: "94105",
    country: "US",
  },
  mainEstablishmentCountry: "US",
  phone: null,
  registrationIdentifier: null,
  taxIdentifier: null,
  manufacturerContactName: "Acme Compliance",
  manufacturerContactEmail: "compliance@acme.test",
  status: "active",
  completionStatus: "complete",
  isDefault: true,
  version: 2,
  dependencyProjections: [],
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  createdBy: actorId,
  updatedBy: actorId,
  deletedAt: null,
};
const createInput: CreateLegalEntityInput = {
  idempotencyKey,
  identifier: "acme-us",
  displayName: "Acme US",
  legalName: "Acme US LLC",
  registeredAddress: {
    addressLine1: "1 Market Street",
    locality: "San Francisco",
    postalCode: "94105",
    country: "US",
  },
  mainEstablishmentCountry: "US",
  manufacturerContactName: "Acme Compliance",
  manufacturerContactEmail: "compliance@acme.test",
};

function harness(result: Readonly<{ data: unknown; error: unknown }>) {
  const rpc = jest.fn().mockResolvedValue(result);
  return {
    repository: new SupabaseLegalEntityRepository({
      admin: () => ({ rpc }),
    } as never),
    rpc,
  };
}

describe("SupabaseLegalEntityRepository", () => {
  it("calls the organization-first list RPC and parses strict legal-entity JSON", async () => {
    const { repository, rpc } = harness({
      data: [{ outcome: "found", legal_entities: [legalEntity] }],
      error: null,
    });

    await expect(
      repository.getLegalEntities(organizationId, actorId),
    ).resolves.toEqual({ outcome: "found", legalEntities: [legalEntity] });
    expect(rpc).toHaveBeenCalledWith("get_organization_legal_entities", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
    });
  });

  it("creates with server-generated ownership and normalized nullable RPC arguments", async () => {
    const { repository, rpc } = harness({
      data: [{ outcome: "created", legal_entity: legalEntity }],
      error: null,
    });

    await expect(
      repository.createLegalEntity(organizationId, actorId, createInput),
    ).resolves.toEqual({ outcome: "created", legalEntity });
    expect(rpc).toHaveBeenCalledWith(
      "create_organization_legal_entity_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_idempotency_key: idempotencyKey,
        p_identifier: "acme-us",
        p_display_name: "Acme US",
        p_legal_name: "Acme US LLC",
        p_address_line_1: "1 Market Street",
        p_address_line_2: null,
        p_locality: "San Francisco",
        p_administrative_area: null,
        p_postal_code: "94105",
        p_registered_address_country: "US",
        p_main_establishment_country: "US",
        p_manufacturer_contact_name: "Acme Compliance",
        p_manufacturer_contact_email: "compliance@acme.test",
        p_phone: null,
        p_registration_identifier: null,
        p_tax_identifier: null,
      },
    );
  });

  it.each([
    "replayed",
    "idempotency_mismatch",
    "conflict",
    "invalid_request",
  ] as const)(
    "maps create %s without accepting malformed payloads",
    async (outcome) => {
      const { repository } = harness({
        data: [
          {
            outcome,
            legal_entity: outcome === "replayed" ? legalEntity : null,
          },
        ],
        error: null,
      });

      await expect(
        repository.createLegalEntity(organizationId, actorId, createInput),
      ).resolves.toEqual(
        outcome === "replayed" ? { outcome, legalEntity } : { outcome },
      );
    },
  );

  it("keeps entity ids organization-scoped for reads and maps foreign misses to generic not-found", async () => {
    const { repository, rpc } = harness({
      data: [{ outcome: "not_found", legal_entity: null }],
      error: null,
    });

    await expect(
      repository.getLegalEntity(organizationId, entityId, actorId),
    ).resolves.toEqual({ outcome: "not_found" });
    expect(rpc).toHaveBeenCalledWith("get_organization_legal_entity", {
      p_organization_id: organizationId,
      p_legal_entity_id: entityId,
      p_actor_user_id: actorId,
    });
  });

  it("uses OCC and returns the contract-safe current entity for an update conflict", async () => {
    const { repository, rpc } = harness({
      data: [{ outcome: "conflict", legal_entity: legalEntity }],
      error: null,
    });
    const input: UpdateLegalEntityInput = {
      ...createInput,
      expectedVersion: 2,
    };

    await expect(
      repository.updateLegalEntity(organizationId, entityId, actorId, input),
    ).resolves.toEqual({ outcome: "conflict", legalEntity });
    expect(rpc).toHaveBeenCalledWith(
      "update_organization_legal_entity_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_legal_entity_id: entityId,
        p_actor_user_id: actorId,
        p_expected_version: 2,
      }),
    );
  });

  it("maps update validation failure and a successful complete entity", async () => {
    const input: UpdateLegalEntityInput = {
      ...createInput,
      expectedVersion: 2,
    };
    const invalid = harness({
      data: [{ outcome: "invalid_request", legal_entity: null }],
      error: null,
    });
    await expect(
      invalid.repository.updateLegalEntity(
        organizationId,
        entityId,
        actorId,
        input,
      ),
    ).resolves.toEqual({ outcome: "invalid_request" });

    const updated = harness({
      data: [{ outcome: "updated", legal_entity: legalEntity }],
      error: null,
    });
    await expect(
      updated.repository.updateLegalEntity(
        organizationId,
        entityId,
        actorId,
        input,
      ),
    ).resolves.toEqual({ outcome: "updated", legalEntity });
  });

  it("permits a stale transition conflict with no entity payload", async () => {
    const { repository } = harness({
      data: [{ outcome: "conflict", legal_entity: null, block_reason: null }],
      error: null,
    });

    await expect(
      repository.transitionLegalEntity(
        organizationId,
        entityId,
        actorId,
        2,
        "inactive",
      ),
    ).resolves.toEqual({ outcome: "conflict" });
  });

  it("maps successful and invalid lifecycle transitions without foreign details", async () => {
    const transitioned = harness({
      data: [
        {
          outcome: "transitioned",
          legal_entity: { ...legalEntity, status: "inactive", version: 3 },
          block_reason: null,
        },
      ],
      error: null,
    });
    await expect(
      transitioned.repository.transitionLegalEntity(
        organizationId,
        entityId,
        actorId,
        2,
        "inactive",
      ),
    ).resolves.toEqual({
      outcome: "transitioned",
      legalEntity: { ...legalEntity, status: "inactive", version: 3 },
    });

    const invalid = harness({
      data: [
        { outcome: "invalid_state", legal_entity: null, block_reason: null },
      ],
      error: null,
    });
    await expect(
      invalid.repository.transitionLegalEntity(
        organizationId,
        entityId,
        actorId,
        2,
        "inactive",
      ),
    ).resolves.toEqual({ outcome: "invalid_state" });
  });

  it("resolves only the immutable active-entity snapshot for owning integrations", async () => {
    const { repository, rpc } = harness({
      data: [
        {
          outcome: "found",
          context: {
            organizationId,
            legalEntityId: entityId,
            legalEntityVersion: 2,
            legalEntitySnapshot: legalEntity,
          },
        },
      ],
      error: null,
    });

    await expect(
      repository.resolveActiveContext(organizationId, entityId),
    ).resolves.toEqual({ outcome: "found", legalEntity });
    expect(rpc).toHaveBeenCalledWith(
      "resolve_active_organization_legal_entity_context",
      { p_organization_id: organizationId, p_legal_entity_id: entityId },
    );
  });

  it("rejects an active-context response whose organization metadata disagrees", async () => {
    const { repository } = harness({
      data: [
        {
          outcome: "found",
          context: {
            organizationId: "00000000-0000-4000-8000-000000000099",
            legalEntityId: entityId,
            legalEntityVersion: 2,
            legalEntitySnapshot: legalEntity,
          },
        },
      ],
      error: null,
    });

    await expect(
      repository.resolveActiveContext(organizationId, entityId),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it("rejects a context whose snapshot identity or version disagrees with its envelope", async () => {
    const { repository } = harness({
      data: [
        {
          outcome: "found",
          context: {
            organizationId,
            legalEntityId: entityId,
            legalEntityVersion: 99,
            legalEntitySnapshot: legalEntity,
          },
        },
      ],
      error: null,
    });

    await expect(
      repository.resolveActiveContext(organizationId, entityId),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it("maps only enumerated dependency blockers and fails malformed provider output closed", async () => {
    const { repository } = harness({
      data: [
        { outcome: "blocked", legal_entity: null, block_reason: "legal_holds" },
      ],
      error: null,
    });
    await expect(
      repository.transitionLegalEntity(
        organizationId,
        entityId,
        actorId,
        2,
        "inactive",
      ),
    ).resolves.toEqual({ outcome: "blocked", reason: "legal_holds" });

    const malformed = harness({
      data: [
        { outcome: "blocked", legal_entity: null, block_reason: "unknown" },
      ],
      error: null,
    });
    await expect(
      malformed.repository.transitionLegalEntity(
        organizationId,
        entityId,
        actorId,
        2,
        "inactive",
      ),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it("forwards owner-provided dependency facts without cross-feature table access", async () => {
    const { repository, rpc } = harness({
      data: [{ outcome: "reconciled" }],
      error: null,
    });

    await expect(
      repository.reconcileDependencies(organizationId, entityId, actorId, {
        authorityKind: "product",
        available: true,
        facts: [{ recordId: "00000000-0000-4000-8000-000000000005", count: 1 }],
      }),
    ).resolves.toEqual({ outcome: "reconciled" });
    expect(rpc).toHaveBeenCalledWith(
      "reconcile_organization_legal_entity_dependencies_atomic",
      {
        p_organization_id: organizationId,
        p_legal_entity_id: entityId,
        p_actor_user_id: actorId,
        p_authority_kind: "product",
        p_available: true,
        p_facts: [
          { recordId: "00000000-0000-4000-8000-000000000005", count: 1 },
        ],
      },
    );
  });

  it.each(["not_found", "invalid_authority", "invalid_facts"] as const)(
    "maps dependency reconciliation %s safely",
    async (outcome) => {
      const { repository } = harness({ data: [{ outcome }], error: null });
      await expect(
        repository.reconcileDependencies(organizationId, entityId, actorId, {
          authorityKind: "retention",
          available: false,
          facts: [],
        }),
      ).resolves.toEqual({ outcome });
    },
  );

  it("maps transport errors and malformed RPC rows to distinct safe provider errors", async () => {
    const unavailable = new SupabaseLegalEntityRepository({
      admin: () => ({ rpc: jest.fn().mockRejectedValue(new Error("offline")) }),
    } as never);
    await expect(
      unavailable.getLegalEntities(organizationId, actorId),
    ).rejects.toMatchObject({ code: "unavailable" });

    const malformed = harness({ data: [], error: null });
    await expect(
      malformed.repository.getLegalEntities(organizationId, actorId),
    ).rejects.toMatchObject({ code: "malformed" });
  });
});
