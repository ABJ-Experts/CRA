/* eslint-disable @typescript-eslint/unbound-method */
import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import {
  ControlBlockedError,
  ControlConflictError,
  ControlForbiddenError,
  ControlInvalidRequestError,
  ControlNotFoundError,
  ControlUseCases,
} from "./application/control-use-cases";
import { ControlsController } from "./controls.controller";

describe("ControlsController", () => {
  const list = jest.fn();
  const ownerCandidates = jest.fn();
  const detail = jest.fn();
  const coverage = jest.fn();
  const command = jest.fn();
  const can = jest.fn().mockResolvedValue(true);
  const controller = new ControlsController(
    {
      list,
      ownerCandidates,
      detail,
      coverage,
      command,
    } as unknown as ControlUseCases,
    { can } as never,
  );
  const user = {
    id: "actor-a",
    organizationId: "org-a",
    role: "owner",
  } as RequestUser;

  beforeEach(() => {
    list.mockReset();
    ownerCandidates.mockReset();
    detail.mockReset();
    coverage.mockReset();
    command.mockReset();
    can.mockResolvedValue(true);
  });

  it("requires permissions on every read and mutation", () => {
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.list),
    ).toEqual(["can_view_frameworks"]);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.coverage),
    ).toEqual([
      "can_view_frameworks",
      "can_view_products",
      "can_view_evidence",
    ]);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.detail),
    ).toEqual(["can_view_frameworks"]);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.create),
    ).toContain("can_manage_frameworks");
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.linkEvidence),
    ).toContain("can_view_evidence");
  });

  it("derives organization from verified user for commands", async () => {
    command.mockResolvedValue({ controlId: "c", revision: 1 });
    await controller.create(
      {
        title: "Control",
        description: "Description",
        ownerUserId: "owner",
        status: "not_started",
        expectedRevision: null,
        idempotencyKey: "key",
      },
      user,
    );
    expect(command).toHaveBeenCalledWith(
      "org-a",
      expect.objectContaining({
        actorId: "actor-a",
        operation: "create_control",
        expectedRevision: null,
      }),
    );
  });

  it("reads list, candidates, detail and coverage under the verified scope", async () => {
    list.mockResolvedValue({ controls: [], nextCursor: null });
    ownerCandidates.mockResolvedValue({ owners: [], nextCursor: null });
    detail.mockResolvedValue({ id: "control-a" });
    coverage.mockResolvedValue({ requirements: [], nextCursor: null });
    await controller.list({ limit: 50, includeArchived: false }, user);
    await controller.ownerCandidates({ limit: 100 }, user);
    await controller.detail({ controlId: "control-a" }, user);
    await controller.coverage(
      { packKey: "cra", versionKey: "2024" },
      { productId: "product-a", limit: 100 },
      user,
    );
    expect(list).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      limit: 50,
      includeArchived: false,
    });
    expect(ownerCandidates).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      limit: 100,
    });
    expect(detail).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      controlId: "control-a",
      canViewEvidence: true,
      canViewProducts: true,
    });
    expect(coverage).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      packKey: "cra",
      versionKey: "2024",
      productId: "product-a",
      limit: 100,
    });
  });

  it("redacts detail when the user has no evidence or product permission", async () => {
    can.mockResolvedValue(false);
    detail.mockResolvedValue({ id: "control-a", evidenceRestricted: true });
    await controller.detail({ controlId: "control-a" }, user);
    expect(detail).toHaveBeenCalledWith(
      "org-a",
      expect.objectContaining({
        canViewEvidence: false,
        canViewProducts: false,
      }),
    );
  });

  it("forwards all state-changing actions to the atomic command boundary", async () => {
    command.mockResolvedValue({ controlId: "control-a", revision: 3 });
    const mutation = { expectedRevision: 2, idempotencyKey: "key" };
    await controller.update(
      { controlId: "control-a" },
      {
        ...mutation,
        title: "Control",
        description: "Description",
        ownerUserId: "owner-a",
        status: "in_progress",
      },
      user,
    );
    await controller.archive({ controlId: "control-a" }, mutation, user);
    await controller.linkEvidence(
      { controlId: "control-a" },
      {
        ...mutation,
        evidenceVersionId: "evidence-a",
        productId: "product-a",
      },
      user,
    );
    await controller.unlinkEvidence(
      { controlId: "control-a", linkId: "link-a" },
      mutation,
      user,
    );
    const mapping = {
      ...mutation,
      packKey: "cra",
      versionKey: "2024",
      requirementKey: "i-1",
      rationale: "Applies",
      productIds: ["product-a"],
    };
    await controller.createMapping({ controlId: "control-a" }, mapping, user);
    await controller.updateMapping(
      { controlId: "control-a", mappingId: "mapping-a" },
      mapping,
      user,
    );
    await controller.endMapping(
      { controlId: "control-a", mappingId: "mapping-a" },
      mutation,
      user,
    );
    const calls = command.mock.calls as Array<[string, { operation: string }]>;
    expect(calls.map((call) => call[1].operation)).toEqual([
      "update_control",
      "archive_control",
      "link_evidence",
      "unlink_evidence",
      "upsert_mapping",
      "upsert_mapping",
      "end_mapping",
    ]);
  });

  it("maps optimistic conflicts and permission denial to HTTP errors", async () => {
    command.mockRejectedValue(new ControlConflictError());
    await expect(
      controller.archive(
        { controlId: "control-a" },
        {
          expectedRevision: 1,
          idempotencyKey: "key",
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 409 });
    list.mockRejectedValue(new ControlForbiddenError());
    await expect(
      controller.list({ limit: 50, includeArchived: false }, user),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    [new ControlInvalidRequestError(), 400],
    [new ControlForbiddenError(), 403],
    [new ControlNotFoundError(), 404],
    [new ControlBlockedError(), 409],
  ])(
    "maps command boundary failures to safe HTTP status",
    async (failure, status) => {
      command.mockRejectedValue(failure);
      await expect(
        controller.archive(
          { controlId: "control-a" },
          {
            expectedRevision: 1,
            idempotencyKey: "key",
          },
          user,
        ),
      ).rejects.toMatchObject({ status });
    },
  );

  it("keeps absent organization, missing role, and missing reads forbidden or not found", async () => {
    await expect(
      controller.list(
        { limit: 50, includeArchived: false },
        {
          ...user,
          organizationId: null,
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.detail(
        { controlId: "control-a" },
        {
          ...user,
          role: null,
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    detail.mockResolvedValue(null);
    await expect(
      controller.detail({ controlId: "control-a" }, user),
    ).rejects.toMatchObject({ status: 404 });
    coverage.mockResolvedValue(null);
    await expect(
      controller.coverage(
        { packKey: "cra", versionKey: "2024" },
        {
          productId: "product-a",
          limit: 100,
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("passes unexpected provider failures to the central exception filter", async () => {
    const failure = new Error("provider offline");
    list.mockRejectedValue(failure);
    await expect(
      controller.list({ limit: 50, includeArchived: false }, user),
    ).rejects.toBe(failure);
  });
});
