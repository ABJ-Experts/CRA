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
      getSupportAlertIntervals: "can_view_products",
      updateSupportAlertIntervals: "can_edit_products",
      getSupportPeriods: "can_view_products",
      previewSupportPeriodChange: "can_edit_products",
      createSupportPeriod: "can_edit_products",
      supersedeSupportPeriod: "can_edit_products",
      getProductRetentionCalculation: "can_view_products",
      getSupportAlertHistory: "can_view_products",
      createSoftwareBaseline: "can_edit_products",
      getSoftwareBaselineHistory: "can_view_products",
      appendSoftwareBaselineRevision: "can_edit_products",
      archiveSoftwareBaseline: "can_edit_products",
      getSoftwareBaselineMemberships: "can_view_products",
      assignSoftwareBaselineMembership: "can_edit_products",
      endSoftwareBaselineMembership: "can_edit_products",
      getProductVariantRelationships: "can_view_products",
      createProductVariantRelationship: "can_edit_products",
      endProductVariantRelationship: "can_edit_products",
      getProductComponentLinks: "can_view_products",
      previewProductComponentLink: "can_edit_products",
      createProductComponentLink: "can_edit_products",
      supersedeProductComponentLink: "can_edit_products",
      endProductComponentLink: "can_edit_products",
      getProductRelationshipGraph: "can_view_products",
      getRelationshipPropagationEvents: "can_view_products",
      requestRelationshipReevaluation: "can_edit_products",
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

  it("requires owner plus delete permission before a support period can shorten", async () => {
    const active = {
      id: "00000000-0000-4000-8000-000000000005",
      supportEndsAt: "2036-08-13T00:00:00.000Z",
      supersededAt: null,
    };
    const products = {
      getSupportPeriods: jest
        .fn()
        .mockResolvedValue({ supportPeriods: [active] }),
      supersedeSupportPeriod: jest.fn().mockResolvedValue({}),
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
      supportPeriodId: active.id,
    };
    const input = {
      supportStartsAt: "2026-08-13T00:00:00.000Z",
      supportEndsAt: "2030-08-13T00:00:00.000Z",
      expectedLifetimeJustification: "A documented expected product lifetime.",
      expectedVersion: 1,
      reason: "Corrected support commitment after compliance review.",
      previewDigest: "a".repeat(64),
    };

    await expect(
      controller.supersedeSupportPeriod(params, input, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(products.supersedeSupportPeriod).not.toHaveBeenCalled();
    expect(permissions.can).not.toHaveBeenCalled();
  });

  it("passes an elevated shortening decision only after owner delete authorization", async () => {
    const active = {
      id: "00000000-0000-4000-8000-000000000005",
      supportEndsAt: "2036-08-13T00:00:00.000Z",
      supersededAt: null,
    };
    const products = {
      getSupportPeriods: jest
        .fn()
        .mockResolvedValue({ supportPeriods: [active] }),
      supersedeSupportPeriod: jest.fn().mockResolvedValue({}),
    };
    const permissions = { can: jest.fn().mockResolvedValue(true) };
    const controller = new ProductsController(
      products as never,
      permissions as never,
    );
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "owner",
    } as RequestUser;
    const params = {
      productId: "00000000-0000-4000-8000-000000000003",
      supportPeriodId: active.id,
    };
    const input = {
      supportStartsAt: "2026-08-13T00:00:00.000Z",
      supportEndsAt: "2030-08-13T00:00:00.000Z",
      expectedLifetimeJustification: "A documented expected product lifetime.",
      expectedVersion: 1,
      reason: "Corrected support commitment after compliance review.",
      previewDigest: "a".repeat(64),
    };

    await controller.supersedeSupportPeriod(params, input, user);

    expect(permissions.can).toHaveBeenCalledWith(
      user.organizationId,
      user.id,
      user.role,
      ["can_delete_products"],
    );
    expect(products.supersedeSupportPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ allowProtectionReduction: true }),
    );
  });

  it("returns alert intervals in the declared wire-contract shape", async () => {
    const intervals = {
      alertIntervalsDays: [180, 90, 30],
      version: 1,
      updatedAt: "2026-08-13T00:00:00.000Z",
      updatedBy: null,
    };
    const products = {
      getSupportAlertIntervals: jest.fn().mockResolvedValue({ intervals }),
      updateSupportAlertIntervals: jest.fn().mockResolvedValue({ intervals }),
    };
    const controller = new ProductsController(products as never, {} as never);
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "owner",
    } as RequestUser;

    await expect(controller.getSupportAlertIntervals(user)).resolves.toEqual(
      intervals,
    );
    await expect(
      controller.updateSupportAlertIntervals(
        { alertIntervalsDays: [180, 90, 30], expectedVersion: 1 },
        user,
      ),
    ).resolves.toEqual(intervals);
  });
});
