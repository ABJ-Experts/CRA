import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { PageParams, Paged } from "@repo/contracts/pagination";
import type { Member } from "@repo/contracts/users";

import type { MemberUseCaseError } from "./application/member-use-cases";
import { UsersService } from "./users.service";

const params = Object.freeze<PageParams>({
  page: 1,
  pageSize: 15,
  order: "asc",
});
const page: Paged<Member> = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 15,
  pageCount: 1,
};
const actor = Object.freeze({ id: "owner-1", email: "owner@cra.test" });

function fixture() {
  const useCases = {
    list: jest.fn().mockResolvedValue({ ok: true, value: page }),
    changeRole: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    remove: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    setActive: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    updateOwnProfile: jest
      .fn()
      .mockResolvedValue({ ok: true, value: undefined }),
  };
  const service = new UsersService(useCases as never);
  return { service, useCases };
}

function responseOf(error: unknown): unknown {
  if (
    error instanceof BadRequestException ||
    error instanceof ConflictException ||
    error instanceof ForbiddenException ||
    error instanceof NotFoundException
  ) {
    return error.getResponse();
  }
  return null;
}

describe("UsersService compatibility facade", () => {
  it("preserves public return values and command shapes", async () => {
    const { service, useCases } = fixture();

    await expect(service.listMembers("org-a", params)).resolves.toBe(page);
    await expect(
      service.changeRole("org-a", actor, "member-1", "admin"),
    ).resolves.toBeUndefined();
    await expect(
      service.removeMember("org-a", actor, "member-1"),
    ).resolves.toBeUndefined();
    await expect(
      service.setActive("org-a", actor, "member-1", false),
    ).resolves.toBeUndefined();
    await expect(
      service.updateProfile(actor.id, { firstName: "Ada" }),
    ).resolves.toBeUndefined();

    expect(useCases.list).toHaveBeenCalledWith({ orgId: "org-a", params });
    expect(useCases.changeRole).toHaveBeenCalledWith({
      orgId: "org-a",
      actor,
      targetUserId: "member-1",
      role: "admin",
    });
    expect(useCases.remove).toHaveBeenCalledWith({
      orgId: "org-a",
      actor,
      targetUserId: "member-1",
    });
    expect(useCases.setActive).toHaveBeenCalledWith({
      orgId: "org-a",
      actor,
      targetUserId: "member-1",
      isActive: false,
    });
    expect(useCases.updateOwnProfile).toHaveBeenCalledWith({
      actorUserId: actor.id,
      targetUserId: actor.id,
      patch: { firstName: "Ada" },
    });
  });

  it.each([
    [
      "list",
      { code: "member_list_failed" },
      BadRequestException,
      {
        message: "We could not load those members.",
        code: "member_list_failed",
      },
    ],
    [
      "changeRole",
      { code: "cannot_change_own_role" },
      ConflictException,
      {
        message: "You cannot change your own role.",
        code: "cannot_change_own_role",
      },
    ],
    [
      "changeRole",
      { code: "member_not_found" },
      NotFoundException,
      {
        message: "That person is not a member of this organization.",
        code: "member_not_found",
      },
    ],
    [
      "changeRole",
      { code: "last_owner" },
      ConflictException,
      {
        message:
          "This organization needs at least one owner. Promote someone else first.",
        code: "last_owner",
      },
    ],
    [
      "remove",
      { code: "cannot_remove_self" },
      ConflictException,
      {
        message: "You cannot remove yourself from the organization.",
        code: "cannot_remove_self",
      },
    ],
    [
      "setActive",
      { code: "cannot_deactivate_self" },
      ConflictException,
      {
        message: "You cannot deactivate your own account.",
        code: "cannot_deactivate_self",
      },
    ],
    [
      "updateOwnProfile",
      { code: "profile_scope_violation" },
      ForbiddenException,
      {
        message: "You can update only your own profile.",
        code: "profile_scope_violation",
      },
    ],
  ] as const)(
    "maps %s semantic failures to the legacy HTTP exception",
    async (operation, error, ExceptionType, response) => {
      const { service, useCases } = fixture();
      useCases[operation].mockResolvedValue({ ok: false, error });

      const promise =
        operation === "list"
          ? service.listMembers("org-a", params)
          : operation === "changeRole"
            ? service.changeRole("org-a", actor, "member-1", "admin")
            : operation === "remove"
              ? service.removeMember("org-a", actor, "member-1")
              : operation === "setActive"
                ? service.setActive("org-a", actor, "member-1", false)
                : service.updateProfile(actor.id, { firstName: "Ada" });

      await expect(promise).rejects.toBeInstanceOf(ExceptionType);
      await promise.catch((caught: unknown) => {
        expect(responseOf(caught)).toEqual(response);
      });
    },
  );

  it.each([
    ["changeRole", "We could not change that role."],
    ["remove", "We could not remove that member."],
    ["setActive", "We could not update that account."],
    ["updateOwnProfile", "We could not save those changes."],
  ] as const)(
    "preserves the %s persistence fallback",
    async (operation, message) => {
      const { service, useCases } = fixture();
      const error: MemberUseCaseError = { code: "update_failed", operation };
      useCases[operation].mockResolvedValue({ ok: false, error });

      const promise =
        operation === "changeRole"
          ? service.changeRole("org-a", actor, "member-1", "admin")
          : operation === "remove"
            ? service.removeMember("org-a", actor, "member-1")
            : operation === "setActive"
              ? service.setActive("org-a", actor, "member-1", false)
              : service.updateProfile(actor.id, { firstName: "Ada" });

      await promise.catch((caught: unknown) => {
        expect(caught).toBeInstanceOf(BadRequestException);
        expect(responseOf(caught)).toEqual({ message, code: "update_failed" });
      });
    },
  );
});
