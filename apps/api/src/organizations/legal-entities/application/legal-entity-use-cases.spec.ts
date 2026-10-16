import type {
  CreateLegalEntityInput,
  LegalEntity,
  UpdateLegalEntityInput,
} from "@repo/contracts/organizations";

import {
  LegalEntityProviderError,
  LegalEntityUseCases,
  type LegalEntityRepository,
} from "./legal-entity-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const entityId = "00000000-0000-4000-8000-000000000003";
const idempotencyKey = "00000000-0000-4000-8000-000000000004";

const legalEntity = Object.freeze<LegalEntity>({
  id: entityId,
  organizationId,
  identifier: "acme-us",
  displayName: "Acme US",
  legalName: "Acme US LLC",
  registeredAddress: {
    addressLine1: "1 Market Street",
    locality: "San Francisco",
    administrativeArea: "CA",
    postalCode: "94105",
    country: "US",
  },
  mainEstablishmentCountry: "US",
  phone: "+14155550100",
  registrationIdentifier: "US123",
  taxIdentifier: "USTAX123",
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
});

const createInput: CreateLegalEntityInput = {
  idempotencyKey,
  identifier: "acme-us",
  displayName: "Acme US",
  legalName: "Acme US LLC",
  registeredAddress: {
    addressLine1: "1 Market Street",
    locality: "San Francisco",
    administrativeArea: "CA",
    postalCode: "94105",
    country: "US",
  },
  mainEstablishmentCountry: "US",
  phone: "+14155550100",
  registrationIdentifier: "us 123",
  taxIdentifier: "us tax 123",
  manufacturerContactName: "Acme Compliance",
  manufacturerContactEmail: "compliance@acme.test",
};

const updateInput: UpdateLegalEntityInput = {
  ...createInput,
  expectedVersion: 2,
};

function repository(
  overrides: Partial<LegalEntityRepository> = {},
): jest.Mocked<LegalEntityRepository> {
  return {
    getLegalEntities: jest
      .fn()
      .mockResolvedValue({ outcome: "found", legalEntities: [legalEntity] }),
    getLegalEntity: jest
      .fn()
      .mockResolvedValue({ outcome: "found", legalEntity }),
    createLegalEntity: jest
      .fn()
      .mockResolvedValue({ outcome: "created", legalEntity }),
    updateLegalEntity: jest
      .fn()
      .mockResolvedValue({ outcome: "updated", legalEntity }),
    transitionLegalEntity: jest
      .fn()
      .mockResolvedValue({ outcome: "transitioned", legalEntity }),
    resolveActiveContext: jest
      .fn()
      .mockResolvedValue({ outcome: "found", legalEntity }),
    reconcileDependencies: jest
      .fn()
      .mockResolvedValue({ outcome: "reconciled" }),
    ...overrides,
  } as jest.Mocked<LegalEntityRepository>;
}

function harness(overrides: Partial<LegalEntityRepository> = {}) {
  const repo = repository(overrides);
  return { repo, useCases: new LegalEntityUseCases(repo) };
}

describe("LegalEntityUseCases", () => {
  it("uses organization-first repository calls and returns immutable response envelopes", async () => {
    const { useCases, repo } = harness();

    await expect(useCases.list(organizationId, actorId)).resolves.toEqual({
      ok: true,
      value: { legalEntities: [legalEntity] },
    });
    await expect(
      useCases.get({ organizationId, actorId, legalEntityId: entityId }),
    ).resolves.toEqual({ ok: true, value: { legalEntity } });

    expect(repo.getLegalEntities).toHaveBeenCalledWith(organizationId, actorId);
    expect(repo.getLegalEntity).toHaveBeenCalledWith(
      organizationId,
      entityId,
      actorId,
    );
  });

  it("delegates idempotent create to the database and maps a reused mismatched key to conflict", async () => {
    const { useCases, repo } = harness();

    await expect(
      useCases.create({ organizationId, actorId, input: createInput }),
    ).resolves.toEqual({ ok: true, value: { legalEntity } });
    expect(repo.createLegalEntity).toHaveBeenCalledWith(
      organizationId,
      actorId,
      createInput,
    );

    const { useCases: conflictUseCases } = harness({
      createLegalEntity: jest.fn().mockResolvedValue({
        outcome: "idempotency_mismatch",
      }),
    });
    await expect(
      conflictUseCases.create({ organizationId, actorId, input: createInput }),
    ).resolves.toEqual({ ok: false, error: { code: "conflict" } });
  });

  it("preserves optimistic-concurrency current state without leaking foreign entities", async () => {
    const { useCases } = harness({
      updateLegalEntity: jest.fn().mockResolvedValue({
        outcome: "conflict",
        legalEntity,
      }),
      getLegalEntity: jest.fn().mockResolvedValue({ outcome: "not_found" }),
    });

    await expect(
      useCases.update({
        organizationId,
        actorId,
        legalEntityId: entityId,
        input: updateInput,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "conflict", current: legalEntity },
    });
    await expect(
      useCases.get({ organizationId, actorId, legalEntityId: entityId }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
  });

  it("maps repository not-found and validation outcomes without forwarding persistence details", async () => {
    const updateCommand = {
      organizationId,
      actorId,
      legalEntityId: entityId,
      input: updateInput,
    };
    const { useCases: missing } = harness({
      getLegalEntities: jest.fn().mockResolvedValue({ outcome: "not_found" }),
      updateLegalEntity: jest.fn().mockResolvedValue({ outcome: "not_found" }),
      transitionLegalEntity: jest
        .fn()
        .mockResolvedValue({ outcome: "not_found" }),
    });
    await expect(missing.list(organizationId, actorId)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(missing.update(updateCommand)).resolves.toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    await expect(
      missing.transition({
        ...updateCommand,
        expectedVersion: 2,
        status: "inactive",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });

    const { useCases: invalid } = harness({
      createLegalEntity: jest
        .fn()
        .mockResolvedValue({ outcome: "invalid_request" }),
      updateLegalEntity: jest
        .fn()
        .mockResolvedValue({ outcome: "invalid_request" }),
    });
    await expect(
      invalid.create({ organizationId, actorId, input: createInput }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    await expect(invalid.update(updateCommand)).resolves.toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  it("returns a payload-free conflict where the database cannot safely return current state", async () => {
    const { useCases } = harness({
      updateLegalEntity: jest.fn().mockResolvedValue({ outcome: "conflict" }),
      transitionLegalEntity: jest
        .fn()
        .mockResolvedValue({ outcome: "conflict" }),
    });
    await expect(
      useCases.update({
        organizationId,
        actorId,
        legalEntityId: entityId,
        input: updateInput,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "conflict" } });
    await expect(
      useCases.transition({
        organizationId,
        actorId,
        legalEntityId: entityId,
        expectedVersion: 2,
        status: "inactive",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "conflict" } });
  });

  it("returns invalid lifecycle state and the successful transition response", async () => {
    const { useCases: invalid } = harness({
      transitionLegalEntity: jest.fn().mockResolvedValue({
        outcome: "invalid_state",
      }),
    });
    await expect(
      invalid.transition({
        organizationId,
        actorId,
        legalEntityId: entityId,
        expectedVersion: 2,
        status: "active",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_state" } });

    const { useCases: transitioned } = harness();
    await expect(
      transitioned.transition({
        organizationId,
        actorId,
        legalEntityId: entityId,
        expectedVersion: 2,
        status: "inactive",
      }),
    ).resolves.toEqual({ ok: true, value: { legalEntity } });
  });

  it("turns lifecycle dependency blocks into specific, count-free safe errors", async () => {
    const { useCases, repo } = harness({
      transitionLegalEntity: jest.fn().mockResolvedValue({
        outcome: "blocked",
        reason: "active_products",
      }),
    });

    await expect(
      useCases.transition({
        organizationId,
        actorId,
        legalEntityId: entityId,
        expectedVersion: 2,
        status: "inactive",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "dependency_blocked", reason: "active_products" },
    });
    expect(repo.transitionLegalEntity).toHaveBeenCalledWith(
      organizationId,
      entityId,
      actorId,
      2,
      "inactive",
    );
  });

  it("fails active context resolution closed for incomplete and inactive entities", async () => {
    const { useCases } = harness({
      resolveActiveContext: jest
        .fn()
        .mockResolvedValue({ outcome: "inactive" }),
    });

    await expect(
      useCases.resolveActiveContext(organizationId, entityId),
    ).resolves.toEqual({ ok: false, error: { code: "inactive" } });
  });

  it("returns a complete active entity as an immutable integration snapshot", async () => {
    const { useCases } = harness();

    const result = await useCases.resolveActiveContext(
      organizationId,
      entityId,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        organizationId,
        legalEntityId: entityId,
        legalEntityVersion: 2,
        legalEntitySnapshot: legalEntity,
      },
    });
    if (!result.ok) throw new Error("Expected active legal-entity context");
    expect(Object.isFrozen(result.value.legalEntitySnapshot)).toBe(true);
    expect(
      Object.isFrozen(result.value.legalEntitySnapshot.registeredAddress),
    ).toBe(true);
    expect(
      Object.isFrozen(result.value.legalEntitySnapshot.dependencyProjections),
    ).toBe(true);
  });

  it("rejects an unexpected inactive or incomplete entity even if a faulty adapter labels it found", async () => {
    const { useCases: inactive } = harness({
      resolveActiveContext: jest.fn().mockResolvedValue({
        outcome: "found",
        legalEntity: { ...legalEntity, status: "inactive" },
      }),
    });
    await expect(
      inactive.resolveActiveContext(organizationId, entityId),
    ).resolves.toEqual({ ok: false, error: { code: "inactive" } });

    const { useCases: incomplete } = harness({
      resolveActiveContext: jest.fn().mockResolvedValue({
        outcome: "found",
        legalEntity: {
          ...legalEntity,
          status: "active",
          completionStatus: "needs_completion",
          identifier: null,
          legalName: null,
          registeredAddress: null,
          mainEstablishmentCountry: null,
          phone: null,
          registrationIdentifier: null,
          taxIdentifier: null,
          manufacturerContactName: null,
          manufacturerContactEmail: null,
          deletedAt: null,
        } as unknown as LegalEntity,
      }),
    });
    await expect(
      incomplete.resolveActiveContext(organizationId, entityId),
    ).resolves.toEqual({ ok: false, error: { code: "incomplete" } });
  });

  it("reconciles only opaque owner facts and maps each safe integration result", async () => {
    const reconciliation = {
      authorityKind: "product" as const,
      available: true,
      facts: [{ recordId: "00000000-0000-4000-8000-000000000099", count: 1 }],
    };
    const { useCases, repo } = harness();
    await expect(
      useCases.reconcile(organizationId, entityId, actorId, reconciliation),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repo.reconcileDependencies).toHaveBeenCalledWith(
      organizationId,
      entityId,
      actorId,
      reconciliation,
    );

    for (const outcome of [
      "not_found",
      "invalid_authority",
      "invalid_facts",
    ] as const) {
      const { useCases: failing } = harness({
        reconcileDependencies: jest.fn().mockResolvedValue({ outcome }),
      });
      await expect(
        failing.reconcile(organizationId, entityId, actorId, reconciliation),
      ).resolves.toEqual({ ok: false, error: { code: outcome } });
    }
  });

  it("converts provider failures into an unavailable error", async () => {
    const { useCases } = harness({
      getLegalEntities: jest
        .fn()
        .mockRejectedValue(new LegalEntityProviderError("unavailable")),
    });

    await expect(useCases.list(organizationId, actorId)).resolves.toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("maps malformed provider data to a safe bad-gateway category for all integration boundaries", async () => {
    const failure = new LegalEntityProviderError("malformed");
    const { useCases } = harness({
      getLegalEntity: jest.fn().mockRejectedValue(failure),
      resolveActiveContext: jest.fn().mockRejectedValue(failure),
      reconcileDependencies: jest.fn().mockRejectedValue(failure),
    });
    await expect(
      useCases.get({ organizationId, actorId, legalEntityId: entityId }),
    ).resolves.toEqual({ ok: false, error: { code: "malformed_provider" } });
    await expect(
      useCases.resolveActiveContext(organizationId, entityId),
    ).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
    await expect(
      useCases.reconcile(organizationId, entityId, actorId, {
        authorityKind: "retention",
        available: false,
        facts: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "malformed_provider" },
    });
  });
});
