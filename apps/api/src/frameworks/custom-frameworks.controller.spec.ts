import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import {
  CustomFrameworkBlockedError,
  CustomFrameworkConflictError,
  CustomFrameworkForbiddenError,
  CustomFrameworkInvalidError,
  CustomFrameworkNotFoundError,
  CustomFrameworkUseCases,
} from "./application/custom-framework-use-cases";
import { CustomFrameworksController } from "./custom-frameworks.controller";

const draftId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";

const content = {
  title: "Internal controls",
  editionDate: "2026-09-25",
  language: "en",
  attribution: "Internal policy",
  requirements: [
    {
      requirementKey: "control-1",
      identifier: "INT-1",
      parentKey: null,
      position: 1,
      heading: "Design review",
      text: "Document design control decisions.",
      sourceReference: "Policy 1",
    },
  ],
};

const summary = {
  draftId,
  packKey: `custom.${draftId}`,
  title: content.title,
  status: "draft",
  revision: 1,
  latestVersionKey: null,
  selectedVersionKey: null,
  contentHash: null,
  archivedAt: null,
  updatedAt: "2026-09-25T00:00:00Z",
};

describe("CustomFrameworksController", () => {
  const list = jest.fn();
  const detail = jest.fn();
  const command = jest.fn();
  const validateImport = jest.fn();
  const exportDraft = jest.fn();
  const controller = new CustomFrameworksController({
    list,
    detail,
    command,
    validateImport,
    export: exportDraft,
  } as unknown as CustomFrameworkUseCases);
  const user = { id: "actor-a", organizationId: "org-a" } as RequestUser;

  beforeEach(() => {
    list.mockReset();
    detail.mockReset();
    command.mockReset();
    validateImport.mockReset();
    exportDraft.mockReset();
  });

  it("declares view and manage permissions on every route", () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.list),
    ).toEqual(["can_view_frameworks"]);
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.detail),
    ).toEqual(["can_view_frameworks"]);
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.export),
    ).toEqual(["can_view_frameworks"]);
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.validate),
    ).toEqual(["can_manage_frameworks"]);
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.create),
    ).toEqual(["can_manage_frameworks"]);
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.update),
    ).toEqual(["can_manage_frameworks"]);
  });

  it("forwards only verified tenant identity to read use cases", async () => {
    list.mockResolvedValue({ items: [summary], nextOffset: null });
    await expect(
      controller.list({ limit: 20, offset: 0 }, user),
    ).resolves.toEqual({ items: [summary], nextOffset: null });
    expect(list).toHaveBeenCalledWith("org-a", "actor-a", 20, 0);

    detail.mockResolvedValue({ ...summary, content });
    await expect(controller.detail({ draftId }, user)).resolves.toMatchObject({
      content,
    });
    expect(detail).toHaveBeenCalledWith("org-a", "actor-a", draftId);

    exportDraft.mockResolvedValue({
      schemaVersion: 1,
      kind: "customer_defined",
      content,
    });
    await controller.export({ draftId }, { versionKey: "v1" }, user);
    expect(exportDraft).toHaveBeenCalledWith("org-a", "actor-a", draftId, "v1");

    await controller.export({ draftId }, {}, user);
    expect(exportDraft).toHaveBeenLastCalledWith(
      "org-a",
      "actor-a",
      draftId,
      undefined,
    );
  });

  it("rejects users without an active organization before application calls", async () => {
    await expect(
      controller.list(
        { limit: 20, offset: 0 },
        { ...user, organizationId: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.detail({ draftId }, { ...user, organizationId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.export({ draftId }, {}, { ...user, organizationId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.create(
        { action: "create_draft", content, idempotencyKey },
        { ...user, organizationId: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("validates imports in the verified organization without storing a draft", async () => {
    validateImport.mockResolvedValue({ valid: false, errors: [] });
    await expect(controller.validate({ unsafe: true }, user)).resolves.toEqual({
      valid: false,
      errors: [],
    });
    expect(validateImport).toHaveBeenCalledWith("org-a", "actor-a", {
      unsafe: true,
    });
    expect(command).not.toHaveBeenCalled();
  });

  it("maps export and create failures through boundary conversion", async () => {
    exportDraft.mockRejectedValue(new CustomFrameworkNotFoundError());
    await expect(
      controller.export({ draftId }, {}, user),
    ).rejects.toBeInstanceOf(NotFoundException);

    command.mockRejectedValue(new CustomFrameworkInvalidError());
    await expect(
      controller.create(
        { action: "create_draft", content, idempotencyKey },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows create only through POST and updates only existing drafts", async () => {
    command.mockResolvedValue(summary);
    await expect(
      controller.create(
        { action: "create_draft", content, idempotencyKey },
        user,
      ),
    ).resolves.toBe(summary);
    expect(command).toHaveBeenCalledWith("org-a", "actor-a", null, {
      action: "create_draft",
      content,
      idempotencyKey,
    });

    await expect(
      controller.create(
        { action: "publish_version", expectedRevision: 1, idempotencyKey },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.update(
        { draftId },
        { action: "create_draft", content, idempotencyKey },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.update(
        { draftId },
        {
          action: "save_draft",
          content,
          expectedRevision: 1,
          idempotencyKey,
        },
        user,
      ),
    ).resolves.toBe(summary);
    expect(command).toHaveBeenCalledWith(
      "org-a",
      "actor-a",
      draftId,
      expect.objectContaining({ action: "save_draft" }),
    );
  });

  it.each([
    [new CustomFrameworkForbiddenError(), ForbiddenException],
    [new CustomFrameworkNotFoundError(), NotFoundException],
    [new CustomFrameworkConflictError(), ConflictException],
    [new CustomFrameworkBlockedError(), ConflictException],
    [new CustomFrameworkInvalidError(), BadRequestException],
  ])("maps application errors", async (failure, expected) => {
    detail.mockRejectedValue(failure);
    await expect(controller.detail({ draftId }, user)).rejects.toBeInstanceOf(
      expected,
    );
  });

  it("passes unknown application errors to the central exception filter", async () => {
    const failure = new Error("provider offline");
    list.mockRejectedValue(failure);
    await expect(controller.list({ limit: 20, offset: 0 }, user)).rejects.toBe(
      failure,
    );

    command.mockRejectedValue(failure);
    await expect(
      controller.update(
        { draftId },
        { action: "publish_version", expectedRevision: 1, idempotencyKey },
        user,
      ),
    ).rejects.toBe(failure);
  });

  it("maps update failures through boundary conversion", async () => {
    command.mockRejectedValue(new CustomFrameworkConflictError());
    await expect(
      controller.update(
        { draftId },
        { action: "archive_draft", expectedRevision: 1, idempotencyKey },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
