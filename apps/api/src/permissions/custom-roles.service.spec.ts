import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { PermissionSet } from "@repo/contracts/permissions";
import type { CustomRole } from "@repo/contracts/roles";

import { CustomRolesService } from "./custom-roles.service";

const actor = Object.freeze({ id: "owner-1", email: "owner@cra.test" });
const role = Object.freeze<CustomRole>({
  id: "00000000-0000-4000-8000-000000000010",
  name: "Support",
  description: null,
  color: "#4A50D6",
  baseRole: "member",
  permissions: { can_view_users: true },
  isSystem: false,
  isActive: true,
  memberCount: 0,
});

function fixture() {
  const useCases = {
    list: jest.fn().mockResolvedValue({ ok: true, value: [role] }),
    create: jest.fn().mockResolvedValue({ ok: true, value: { id: role.id } }),
    update: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    remove: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    overrides: jest.fn().mockResolvedValue({
      ok: true,
      value: { member: { can_view_users: true } },
    }),
    setOverride: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
  const service = new CustomRolesService(useCases as never);
  return { service, useCases };
}

type Operation =
  "list" | "create" | "update" | "remove" | "overrides" | "setOverride";

function invoke(service: CustomRolesService, operation: Operation) {
  switch (operation) {
    case "list":
      return service.list("org-a");
    case "create":
      return service.create("org-a", actor, {
        name: "Support",
        baseRole: "member",
        permissions: {},
      });
    case "update":
      return service.update("org-a", actor, role.id, { name: "New" });
    case "remove":
      return service.remove("org-a", actor, role.id);
    case "overrides":
      return service.overrides("org-a");
    case "setOverride":
      return service.setOverride("org-a", actor, "member", {});
  }
}

describe("CustomRolesService compatibility facade", () => {
  it("preserves every public method and command shape", async () => {
    const { service, useCases } = fixture();
    const createInput = {
      name: "Support",
      description: "Support team",
      color: "#4A50D6",
      baseRole: "member" as const,
      permissions: { can_view_users: true },
    };
    const updatePatch = {
      name: "New",
      permissions: { can_edit_users: true },
      isActive: false,
    };
    const permissions: PermissionSet = { can_view_users: false };

    await expect(service.list("org-a")).resolves.toEqual([role]);
    await expect(service.create("org-a", actor, createInput)).resolves.toEqual({
      id: role.id,
    });
    await expect(
      service.update("org-a", actor, role.id, updatePatch),
    ).resolves.toBeUndefined();
    await expect(
      service.remove("org-a", actor, role.id),
    ).resolves.toBeUndefined();
    await expect(service.overrides("org-a")).resolves.toEqual({
      member: { can_view_users: true },
    });
    await expect(
      service.setOverride("org-a", actor, "member", permissions),
    ).resolves.toBeUndefined();

    expect(useCases.list).toHaveBeenCalledWith({ orgId: "org-a" });
    expect(useCases.create).toHaveBeenCalledWith({
      orgId: "org-a",
      actor,
      input: createInput,
    });
    expect(useCases.update).toHaveBeenCalledWith({
      orgId: "org-a",
      actor,
      roleId: role.id,
      patch: updatePatch,
    });
    expect(useCases.remove).toHaveBeenCalledWith({
      orgId: "org-a",
      actor,
      roleId: role.id,
    });
    expect(useCases.overrides).toHaveBeenCalledWith({ orgId: "org-a" });
    expect(useCases.setOverride).toHaveBeenCalledWith({
      orgId: "org-a",
      actor,
      baseRole: "member",
      permissions,
    });
  });

  it.each([
    [
      "list",
      { code: "role_list_failed" },
      BadRequestException,
      { message: "We could not load those roles.", code: "role_list_failed" },
    ],
    [
      "create",
      { code: "role_name_taken" },
      ConflictException,
      {
        message: "A role with that name already exists.",
        code: "role_name_taken",
        fieldErrors: { name: "That name is already in use." },
      },
    ],
    [
      "create",
      { code: "role_create_failed" },
      BadRequestException,
      { message: "We could not create that role.", code: "role_create_failed" },
    ],
    [
      "update",
      { code: "role_not_found" },
      NotFoundException,
      { message: "That role no longer exists.", code: "role_not_found" },
    ],
    [
      "update",
      { code: "role_is_system", operation: "update" },
      ConflictException,
      { message: "System roles cannot be edited.", code: "role_is_system" },
    ],
    [
      "remove",
      { code: "role_is_system", operation: "remove" },
      ConflictException,
      { message: "System roles cannot be deleted.", code: "role_is_system" },
    ],
    [
      "update",
      { code: "role_update_failed" },
      BadRequestException,
      { message: "We could not save that role.", code: "role_update_failed" },
    ],
    [
      "remove",
      { code: "role_delete_failed" },
      BadRequestException,
      { message: "We could not delete that role.", code: "role_delete_failed" },
    ],
    [
      "setOverride",
      { code: "override_failed" },
      BadRequestException,
      {
        message: "We could not save those permissions.",
        code: "override_failed",
      },
    ],
  ] as const)(
    "maps %s semantic failures to the legacy exception",
    async (operation, error, ExceptionType, response) => {
      const { service, useCases } = fixture();
      useCases[operation].mockResolvedValue({ ok: false, error });

      let caught: unknown;
      try {
        await invoke(service, operation);
      } catch (exception) {
        caught = exception;
      }

      expect(caught).toBeInstanceOf(ExceptionType);
      expect(
        caught instanceof BadRequestException ||
          caught instanceof ConflictException ||
          caught instanceof NotFoundException
          ? caught.getResponse()
          : null,
      ).toEqual(response);
    },
  );

  it("does not invent an error path for fail-open override reads", async () => {
    const { service, useCases } = fixture();
    useCases.overrides.mockResolvedValue({ ok: true, value: {} });

    await expect(service.overrides("org-a")).resolves.toEqual({});
  });
});
