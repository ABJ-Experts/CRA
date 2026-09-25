import {
  FindingResponsibleSuppliersController,
  SupplierRegistryController,
} from "./supplier-registry.controller";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
} as never;

describe("SupplierRegistryController", () => {
  it("does not accept a caller-provided organization when creating a supplier", async () => {
    const createSupplier = jest.fn().mockResolvedValue({ id: "supplier" });
    const controller = new SupplierRegistryController({
      createSupplier,
    } as never);

    await expect(
      controller.create(
        {
          name: "Example Components",
          criticality: "high",
          duplicateCandidateIdsConfirmed: [],
          idempotencyKey: "33333333-3333-4333-8333-333333333333",
        },
        user,
      ),
    ).resolves.toEqual({ supplier: { id: "supplier" } });
    expect(createSupplier).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        actorId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("preserves an explicit unknown finding-responsibility result", async () => {
    const findingResponsibleSuppliers = jest.fn().mockResolvedValue({
      findingId: "44444444-4444-4444-8444-444444444444",
      responsibility: "unknown",
      suppliers: [],
    });
    const controller = new FindingResponsibleSuppliersController({
      findingResponsibleSuppliers,
    } as never);

    await expect(
      controller.resolve(
        { findingId: "44444444-4444-4444-8444-444444444444" },
        user,
      ),
    ).resolves.toEqual({
      resolution: {
        findingId: "44444444-4444-4444-8444-444444444444",
        responsibility: "unknown",
        suppliers: [],
      },
    });
  });
});
