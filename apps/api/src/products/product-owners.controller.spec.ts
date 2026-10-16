import type { PermissionsService } from "../permissions/permissions.service";
import { ProductOwnerAccessDenied } from "./application/product-owner-options";
import type { ProductOwnerOptions } from "./application/product-owner-options";
import type { RequestUser } from "../auth/auth.types";
import { ProductOwnersController } from "./product-owners.controller";
import { REQUIRE_PERMISSIONS_KEY } from "../auth/auth.types";
const permissionFixture = {
  effectivePermissions: jest
    .fn()
    .mockResolvedValue({ can_create_products: true }),
} as unknown as PermissionsService;
const query = { page: 1, pageSize: 25 };
describe("owner route", () => {
  it("fails closed on permission resolution outage", async () => {
    const list = jest.fn();
    const permissions = {
      effectivePermissions: jest.fn().mockRejectedValue(new Error("private")),
    } as unknown as PermissionsService;
    await expect(
      new ProductOwnersController(
        { list } as unknown as ProductOwnerOptions,
        permissions,
      ).list(query, { organizationId: "org", role: "owner" } as RequestUser),
    ).rejects.toThrow("Responsible owners are temporarily unavailable.");
    expect(list).not.toHaveBeenCalled();
  });

  it("preserves denied directory policy as 403", async () => {
    const owners = {
      list: jest
        .fn()
        .mockRejectedValue(
          new ProductOwnerAccessDenied("Owner directory access is required."),
        ),
    } as unknown as ProductOwnerOptions;
    await expect(
      new ProductOwnersController(owners, permissionFixture).list(query, {
        organizationId: "org",
        role: "viewer",
      } as RequestUser),
    ).rejects.toThrow("Owner directory access is required.");
  });
  it("does not trust base-role labels over resolved revocation", async () => {
    const list = jest.fn().mockResolvedValue({});
    const permissions = {
      effectivePermissions: jest.fn().mockResolvedValue({
        can_create_products: false,
        can_edit_products: false,
        can_view_users: false,
      }),
    } as unknown as PermissionsService;
    await new ProductOwnersController(
      { list } as unknown as ProductOwnerOptions,
      permissions,
    ).list(query, { organizationId: "org", role: "owner" } as RequestUser);
    expect(list).toHaveBeenCalledWith("org", query, false);
  });

  it("requires product visibility", () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        Object.getOwnPropertyDescriptor(
          ProductOwnersController.prototype,
          "list",
        )?.value as object,
      ),
    ).toEqual(["can_view_products"]);
  });
  it("uses session organization", async () => {
    const list = jest.fn().mockResolvedValue({});
    const controller = new ProductOwnersController(
      {
        list,
      } as unknown as ProductOwnerOptions,
      permissionFixture,
    );
    await controller.list(query, {
      organizationId: "trusted",
      role: "owner",
    } as RequestUser);
    expect(list).toHaveBeenCalledWith("trusted", query, true);
  });
  it("denies missing scope", async () => {
    await expect(
      new ProductOwnersController(
        {} as ProductOwnerOptions,
        permissionFixture,
      ).list(query, {} as RequestUser),
    ).rejects.toThrow("An organization is required.");
  });
  it("conceals unexpected adapter errors", async () => {
    await expect(
      new ProductOwnersController(
        {
          list: jest.fn().mockRejectedValue(new Error("private")),
        } as unknown as ProductOwnerOptions,
        permissionFixture,
      ).list(query, {
        organizationId: "org",
        role: "owner",
      } as RequestUser),
    ).rejects.toThrow("Responsible owners are temporarily unavailable.");
  });
});
