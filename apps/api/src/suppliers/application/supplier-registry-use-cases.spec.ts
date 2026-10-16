import type { SupplierRegistryRepository } from "./supplier-registry-use-cases";
import { SupplierRegistryUseCases } from "./supplier-registry-use-cases";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const supplierId = "33333333-3333-4333-8333-333333333333";

describe("SupplierRegistryUseCases", () => {
  it("keeps the organization boundary ahead of every repository command", async () => {
    const repository = fakeRepository();
    const useCases = new SupplierRegistryUseCases(repository);

    await useCases.archiveSupplier(organizationId, {
      actorId,
      supplierId,
      expectedVersion: 3,
      reason: "Supplier relationship ended",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });

    expect(repository.archiveSupplier.mock.calls[0]).toEqual([
      organizationId,
      expect.objectContaining({ actorId, supplierId, expectedVersion: 3 }),
    ]);
  });

  it("does not turn an unknown finding responsibility into a supplier", async () => {
    const repository = fakeRepository();
    repository.findingResponsibleSuppliers.mockResolvedValue({
      findingId: "55555555-5555-4555-8555-555555555555",
      responsibility: "unknown",
      suppliers: [],
    });
    const useCases = new SupplierRegistryUseCases(repository);

    await expect(
      useCases.findingResponsibleSuppliers(organizationId, {
        actorId,
        findingId: "55555555-5555-4555-8555-555555555555",
      }),
    ).resolves.toMatchObject({ responsibility: "unknown", suppliers: [] });
  });
});

function fakeRepository(): jest.Mocked<SupplierRegistryRepository> {
  return {
    listSuppliers: jest.fn(),
    getSupplier: jest.fn(),
    createSupplier: jest.fn(),
    updateSupplier: jest.fn(),
    archiveSupplier: jest.fn().mockResolvedValue({}),
    createContact: jest.fn(),
    updateContact: jest.fn(),
    archiveContact: jest.fn(),
    createResponsibility: jest.fn(),
    endResponsibility: jest.fn(),
    associateRequest: jest.fn(),
    findingResponsibleSuppliers: jest.fn(),
  };
}
