import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import {
  FrameworkConflictError,
  FrameworkForbiddenError,
  FrameworkInvalidRequestError,
  FrameworkUpgradeRequiredError,
  FrameworkPackBlockedError,
  FrameworkUseCases,
} from "./application/framework-use-cases";
import { FrameworksController } from "./frameworks.controller";

describe("FrameworksController", () => {
  const catalog = jest.fn();
  const tree = jest.fn();
  const select = jest.fn();
  const controller = new FrameworksController({
    catalog,
    tree,
    select,
  } as unknown as FrameworkUseCases);
  const user = { id: "actor-a", organizationId: "org-a" } as RequestUser;
  const params = { packKey: "cra", versionKey: "2024" };
  const body = {
    versionKey: "2024",
    enabled: true,
    expectedRevision: 1,
    idempotencyKey: "2f564a90-a9ef-46e9-afd8-b743866860ff",
  };

  beforeEach(() => {
    catalog.mockReset();
    tree.mockReset();
    select.mockReset();
  });

  it("declares view and manage permissions on every route", () => {
    // Nest stores method metadata on the original unbound function.
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.catalog),
    ).toEqual(["can_view_frameworks"]);
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.tree),
    ).toEqual(["can_view_frameworks"]);
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.select),
    ).toEqual(["can_view_frameworks", "can_manage_frameworks"]);
  });

  it("forwards only verified tenant identity to the application", async () => {
    catalog.mockResolvedValue({ packs: [] });
    await controller.catalog(user);
    expect(catalog).toHaveBeenCalledWith("org-a", "actor-a", { limit: 100 });
    tree.mockResolvedValue(null);
    await expect(
      controller.tree(
        { packKey: "cra", versionKey: "2024" },
        { limit: 100 },
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tree).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      packKey: "cra",
      versionKey: "2024",
      limit: 100,
    });
  });

  it("rejects users without an active organization", async () => {
    await expect(
      controller.catalog({ ...user, organizationId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(catalog).not.toHaveBeenCalled();
  });

  it("maps a revoked catalog membership to forbidden", async () => {
    catalog.mockRejectedValue(new FrameworkForbiddenError());
    await expect(controller.catalog(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("rejects malformed catalog cursors without exposing database errors", async () => {
    catalog.mockRejectedValue(new FrameworkInvalidRequestError());
    await expect(
      controller.catalog(user, { limit: 100, cursor: "bad" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("maps stale selection to a conflict", async () => {
    select.mockRejectedValue(new FrameworkConflictError());
    await expect(
      controller.select({ packKey: "cra" }, body, user),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(select).toHaveBeenCalledWith(
      "org-a",
      expect.objectContaining({
        actorId: "actor-a",
        packKey: "cra",
        expectedRevision: 1,
      }),
    );
  });

  it("returns a stable conflict when version changes require review", async () => {
    select.mockRejectedValue(new FrameworkUpgradeRequiredError());
    await expect(
      controller.select({ packKey: "cra" }, body, user),
    ).rejects.toMatchObject({
      response: { code: "framework_upgrade_required" },
    });
  });

  it("returns a stable conflict for an unauthorized edition", async () => {
    select.mockRejectedValue(new FrameworkPackBlockedError());
    await expect(
      controller.select({ packKey: "iec-62443-4-1" }, body, user),
    ).rejects.toMatchObject({
      response: { code: "framework_pack_blocked" },
    });
  });

  it("returns a known tree without changing its contract", async () => {
    const response = {
      packKey: "cra",
      versionKey: "2024",
      requirements: [],
      nextCursor: null,
    };
    tree.mockResolvedValue(response);
    await expect(controller.tree(params, { limit: 10 }, user)).resolves.toBe(
      response,
    );
  });

  it.each([
    [new FrameworkInvalidRequestError(), BadRequestException],
    [new FrameworkForbiddenError(), ForbiddenException],
  ])("maps tree boundary errors", async (failure, expected) => {
    tree.mockRejectedValue(failure);
    await expect(
      controller.tree(params, { limit: 10 }, user),
    ).rejects.toBeInstanceOf(expected);
  });

  it.each([
    [new FrameworkInvalidRequestError(), BadRequestException],
    [new FrameworkForbiddenError(), ForbiddenException],
  ])("maps selection boundary errors", async (failure, expected) => {
    select.mockRejectedValue(failure);
    await expect(
      controller.select({ packKey: "cra" }, body, user),
    ).rejects.toBeInstanceOf(expected);
  });

  it("passes unknown application errors to the central exception filter", async () => {
    const error = new Error("provider offline");
    catalog.mockRejectedValue(error);
    await expect(controller.catalog(user)).rejects.toBe(error);
    tree.mockRejectedValue(error);
    await expect(controller.tree(params, { limit: 10 }, user)).rejects.toBe(
      error,
    );
    select.mockRejectedValue(error);
    await expect(
      controller.select({ packKey: "cra" }, body, user),
    ).rejects.toBe(error);
  });
});
