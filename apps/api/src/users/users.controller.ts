import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from "@nestjs/common";
import { BASE_ROLES, type BaseRole } from "@repo/contracts/permissions";
import type { Paged } from "@repo/contracts/pagination";
import { parsePageParams } from "@repo/contracts/pagination";
import { z } from "zod";

import { zodBody } from "../common/pipes/zod-validation.pipe";
import {
  CurrentUser,
  RequirePermissions,
  SelfScoped,
  type RequestUser,
} from "../auth/auth.types";
import { UsersService, type MemberRow } from "./users.service";

const uuid = z.string().uuid();
const roleSchema = z.object({ role: z.enum(BASE_ROLES) });
const activeSchema = z.object({ isActive: z.boolean() });
const profileSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  language: z.string().trim().max(10).optional(),
});

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Everything here is scoped to the caller's active organization. */
  private orgOf(user: RequestUser): string {
    if (!user.organizationId) {
      throw new ForbiddenException({
        message: "You are not a member of any organization.",
        code: "no_organization",
      });
    }
    return user.organizationId;
  }

  @RequirePermissions("can_view_users")
  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("sort") sort?: string,
    @Query("order") order?: string,
    @Query("q") q?: string,
  ): Promise<Paged<MemberRow>> {
    return this.users.listMembers(
      this.orgOf(user),
      parsePageParams({ page, pageSize, sort, order, q }),
    );
  }

  @SelfScoped("Updates only the caller's own profile row.")
  @Patch("me")
  @HttpCode(HttpStatus.OK)
  async updateMe(
    @Body(zodBody(profileSchema)) dto: z.infer<typeof profileSchema>,
    @CurrentUser("id") userId: string,
  ): Promise<{ ok: true }> {
    await this.users.updateProfile(userId, dto);
    return { ok: true };
  }

  @RequirePermissions("can_edit_users")
  @Patch(":id/role")
  @HttpCode(HttpStatus.OK)
  async changeRole(
    @Param("id") id: string,
    @Body(zodBody(roleSchema)) dto: { role: BaseRole },
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true }> {
    uuid.parse(id);
    await this.users.changeRole(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
      dto.role,
    );
    return { ok: true };
  }

  @RequirePermissions("can_edit_users")
  @Patch(":id/active")
  @HttpCode(HttpStatus.OK)
  async setActive(
    @Param("id") id: string,
    @Body(zodBody(activeSchema)) dto: { isActive: boolean },
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true }> {
    uuid.parse(id);
    await this.users.setActive(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
      dto.isActive,
    );
    return { ok: true };
  }

  @RequirePermissions("can_delete_users")
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true }> {
    uuid.parse(id);
    await this.users.removeMember(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
    );
    return { ok: true };
  }
}
