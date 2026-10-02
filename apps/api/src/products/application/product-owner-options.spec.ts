import { ProductOwnerOptions } from "./product-owner-options";
describe("product owner directory", () => {
  it("denies arbitrary directory lookup by a read-only viewer", async () => {
    const list = jest.fn();
    await expect(
      new ProductOwnerOptions({ list, ownerForProduct: jest.fn() }).list(
        "org",
        { page: 1, pageSize: 25, selectedOwnerId: "someone" },
        false,
      ),
    ).rejects.toThrow("Owner directory access is required.");
    expect(list).not.toHaveBeenCalled();
  });
  it("returns only the current scoped product owner for a read-only viewer", async () => {
    const list = jest.fn();
    const ownerForProduct = jest.fn().mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Owner",
    });
    const result = await new ProductOwnerOptions({
      list,
      ownerForProduct,
    }).list("org", { page: 1, pageSize: 25, productId: "product" }, false);
    expect(result.owners.rows).toEqual([]);
    expect(result.selectedOwner?.displayName).toBe("Owner");
    expect(ownerForProduct).toHaveBeenCalledWith("org", "product");
    expect(list).not.toHaveBeenCalled();
  });

  it("passes only verified organization and parsed query to the directory", async () => {
    const response = {
      owners: { rows: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
      selectedOwner: null,
    };
    const list = jest.fn().mockResolvedValue(response);
    expect(
      await new ProductOwnerOptions({ list, ownerForProduct: jest.fn() }).list(
        "trusted-org",
        {
          page: 1,
          pageSize: 25,
        },
        true,
      ),
    ).toEqual(response);
    expect(list).toHaveBeenCalledWith("trusted-org", { page: 1, pageSize: 25 });
  });
  it("rejects malformed provider output", async () => {
    await expect(
      new ProductOwnerOptions({
        list: jest.fn().mockResolvedValue({ owners: [] }),
        ownerForProduct: jest.fn(),
      }).list("org", { page: 1, pageSize: 25 }, true),
    ).rejects.toThrow();
  });
});
