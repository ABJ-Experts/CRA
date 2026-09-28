import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import { ProductClassificationsController } from "./product-classifications.controller";
import {
  ClassificationFailure,
  type ProductClassificationUseCases,
} from "./application/product-classification";
const user = { id: "actor", organizationId: "org" } as RequestUser;
function fixture() {
  const calls = {
    policy: jest.fn().mockReturnValue({ policy: "fixed" }),
    latest: jest.fn().mockResolvedValue({}),
    history: jest.fn().mockResolvedValue({}),
    save: jest.fn().mockResolvedValue({}),
  };
  return {
    calls,
    controller: new ProductClassificationsController(
      calls as unknown as ProductClassificationUseCases,
    ),
  };
}
describe("classification parsed routes", () => {
  it.each(["policy", "latest", "history"])(
    "permission-gates %s read",
    (name) => {
      const method = Object.getOwnPropertyDescriptor(
        ProductClassificationsController.prototype,
        name,
      )?.value as object;
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, method)).toEqual([
        "can_view_products",
      ]);
    },
  );
  it("permission-gates writes", () =>
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        Object.getOwnPropertyDescriptor(
          ProductClassificationsController.prototype,
          "save",
        )?.value as object,
      ),
    ).toEqual(["can_edit_products"]));
  it("uses verified org and actor on all reads", async () => {
    const f = fixture();
    const query = { productIds: ["p"] };
    expect(f.controller.policy(user)).toEqual({ policy: "fixed" });
    await f.controller.latest(query, user);
    await f.controller.history(
      { productId: "p" },
      { page: 1, pageSize: 15 },
      user,
    );
    expect(f.calls.latest).toHaveBeenCalledWith("org", "actor", query);
    expect(f.calls.history).toHaveBeenCalledWith("org", "actor", "p", {
      page: 1,
      pageSize: 15,
    });
  });
  it("uses verified scope for save", async () => {
    const f = fixture();
    const input = {} as Parameters<ProductClassificationsController["save"]>[1];
    await f.controller.save({ productId: "p" }, input, user);
    expect(f.calls.save).toHaveBeenCalledWith("org", "actor", "p", input);
  });
  it("denies missing org", async () => {
    const f = fixture();
    expect(() => f.controller.policy({} as RequestUser)).toThrow(
      "An organization is required.",
    );
    await expect(
      f.controller.latest({ productIds: [] }, {} as RequestUser),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    ["not_found", 404],
    ["forbidden", 403],
    ["invalid_request", 400],
    ["conflict", 409],
    ["invalid_state", 409],
    ["idempotency_mismatch", 409],
    ["malformed_provider", 502],
    ["unavailable", 503],
  ] as const)(
    "maps %s without exposing provider data",
    async (code, status) => {
      const f = fixture();
      f.calls.latest.mockRejectedValue(new ClassificationFailure(code));
      await expect(
        f.controller.latest({ productIds: ["p"] }, user),
      ).rejects.toMatchObject({ status });
    },
  );
  it("conceals unexpected errors", async () => {
    const f = fixture();
    f.calls.latest.mockRejectedValue(new Error("private SQL"));
    await expect(
      f.controller.latest({ productIds: ["p"] }, user),
    ).rejects.toThrow("Product classifications are temporarily unavailable.");
  });
});
