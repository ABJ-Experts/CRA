import { PATH_METADATA } from "@nestjs/common/constants";
import { ForbiddenException } from "@nestjs/common";

import {
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  type RequestUser,
} from "../auth/auth.types";
import { ProductsController } from "./products.controller";

describe("ProductsController", () => {
  it("uses the dedicated product route prefix", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ProductsController)).toBe(
      "products",
    );
  });

  it("declares product permissions on every route and owner-only entity reassignment", () => {
    const permissions: Record<string, string> = {
      list: "can_view_products",
      get: "can_view_products",
      create: "can_create_products",
      update: "can_edit_products",
      assignLegalEntity: "can_edit_products",
      archive: "can_delete_products",
      listReleases: "can_view_products",
      createRelease: "can_create_products",
      getRelease: "can_view_products",
      updateRelease: "can_edit_products",
      archiveRelease: "can_delete_products",
      listMemberStates: "can_view_products",
      getReleaseMarketAvailability: "can_view_products",
      addReleaseMarketAvailability: "can_edit_products",
      removeReleaseMarketAvailability: "can_edit_products",
      correctReleaseMarketAvailability: "can_edit_products",
      transitionReleaseLifecycle: "can_edit_products",
      correctPlacedOnMarketDate: "can_edit_products",
      getReleaseLifecycleTimeline: "can_view_products",
    };
    for (const [name, permission] of Object.entries(permissions)) {
      const handler = Object.getOwnPropertyDescriptor(
        ProductsController.prototype,
        name,
      )?.value as object;
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
        permission,
      ]);
    }
    const move = Object.getOwnPropertyDescriptor(
      ProductsController.prototype,
      "assignLegalEntity",
    )?.value as object;
    expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, move)).toBe("owner");
    const placedDateCorrection = Object.getOwnPropertyDescriptor(
      ProductsController.prototype,
      "correctPlacedOnMarketDate",
    )?.value as object;
    expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, placedDateCorrection)).toBe(
      "owner",
    );
  });

  it("requires delete permission only for withdrawal transitions", async () => {
    const products = {
      transitionReleaseLifecycle: jest.fn().mockResolvedValue({}),
    };
    const permissions = { can: jest.fn().mockResolvedValue(false) };
    const controller = new ProductsController(
      products as never,
      permissions as never,
    );
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "admin",
    } as RequestUser;
    const params = {
      productId: "00000000-0000-4000-8000-000000000003",
      releaseId: "00000000-0000-4000-8000-000000000004",
    };

    await controller.transitionReleaseLifecycle(
      params,
      { targetState: "in_support", expectedVersion: 1 },
      user,
    );
    expect(permissions.can).not.toHaveBeenCalled();

    await expect(
      controller.transitionReleaseLifecycle(
        params,
        { targetState: "withdrawn", expectedVersion: 1, reason: "End sale" },
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissions.can).toHaveBeenCalledWith(
      user.organizationId,
      user.id,
      user.role,
      ["can_delete_products"],
    );
  });
});
