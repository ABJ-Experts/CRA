import {
  SupplierRegistryConflictError,
  SupplierRegistryDuplicateCandidatesError,
  SupplierRegistryForbiddenError,
} from "../application/supplier-registry-use-cases";
import { SupabaseSupplierRegistryRepository } from "./supabase-supplier-registry.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const supplierId = "33333333-3333-4333-8333-333333333333";

describe("SupabaseSupplierRegistryRepository", () => {
  it("sends the organization scope to a registry read and preserves a denial", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "forbidden", result: null }],
      error: null,
    });
    const repository = repositoryFor(rpc);

    await expect(
      repository.listSuppliers(organizationId, { actorId, limit: 25 }),
    ).rejects.toBeInstanceOf(SupplierRegistryForbiddenError);
    expect(rpc).toHaveBeenCalledWith("list_supplier_organizations_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_search: null,
      p_include_archived: false,
      p_limit: 25,
      p_cursor: null,
    });
  });

  it("returns duplicate candidates instead of silently merging a same-name supplier", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "duplicate_confirmation_required",
          result: {
            duplicateCandidates: [
              {
                id: supplierId,
                organizationId,
                name: "Same Name",
                criticality: "high",
                state: "active",
                componentCount: 0,
              },
            ],
          },
        },
      ],
      error: null,
    });
    const repository = repositoryFor(rpc);

    await expect(
      repository.createSupplier(organizationId, {
        actorId,
        name: "Same Name",
        criticality: "high",
        duplicateCandidateIdsConfirmed: [],
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toBeInstanceOf(SupplierRegistryDuplicateCandidatesError);
  });

  it("keeps explicit null clears in the atomic partial-update patch", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "conflict", result: null }],
      error: null,
    });
    const repository = repositoryFor(rpc);

    await expect(
      repository.updateSupplier(organizationId, {
        actorId,
        supplierId,
        legalName: null,
        expectedVersion: 2,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toBeInstanceOf(SupplierRegistryConflictError);
    expect(rpc).toHaveBeenCalledWith("update_supplier_organization_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_supplier_id: supplierId,
      p_patch: { legalName: null },
      p_expected_version: 2,
      p_idempotency_key: "55555555-5555-4555-8555-555555555555",
    });
  });

  it("strictly flattens the database detail projection at the contract boundary", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "found", result: supplierDetailProjection() }],
      error: null,
    });
    const repository = repositoryFor(rpc);

    await expect(
      repository.getSupplier(organizationId, { actorId, supplierId }),
    ).resolves.toMatchObject({
      id: supplierId,
      contacts: [],
      responsibilities: [],
      requestHistory: [],
    });
  });
});

function repositoryFor(rpc: jest.Mock): SupabaseSupplierRegistryRepository {
  return new SupabaseSupplierRegistryRepository({
    admin: () => ({ rpc }),
  } as never);
}

function supplierDetailProjection() {
  const timestamp = "2026-09-21T12:00:00.000Z";
  return {
    id: supplierId,
    organizationId,
    name: "Example Components",
    legalName: null,
    website: null,
    criticality: "high",
    state: "active",
    version: 0,
    componentCount: 0,
    requestCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    contacts: [],
    responsibilities: [],
    requestHistory: [],
  };
}
