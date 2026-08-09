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
  Post,
  Put,
} from "@nestjs/common";
import {
  createRoleInputSchema,
  roleListResponseSchema,
  roleIdParamSchema,
  roleOverridesResponseSchema,
  setRoleOverrideInputSchema,
  updateRoleInputSchema,
} from "@repo/contracts/roles/schemas";
import type {
  CreateRoleInput,
  RoleIdParam,
  RoleListResponse,
  RoleOverridesResponse,
  SetRoleOverrideInput,
  UpdateRoleInput,
} from "@repo/contracts/roles/types";
import {
  idResponseSchema,
  okResponseSchema,
} from "@repo/contracts/shared/schemas";
import type { IdResponse, OkResponse } from "@repo/contracts/shared/types";

import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { CustomRolesService } from "./custom-roles.service";

@Controller("roles")
export class CustomRolesController {
  constructor(private readonly roles: CustomRolesService) {}

  private orgOf(user: RequestUser): string {
    if (!user.organizationId) {
      throw new ForbiddenException({
        message: "You are not a member of any organization.",
        code: "no_organization",
      });
    }
    return user.organizationId;
  }

  @RequirePermissions("can_view_roles")
  @Get()
  @ZodResponse(roleListResponseSchema)
  async list(@CurrentUser() user: RequestUser): Promise<RoleListResponse> {
    return { rows: await this.roles.list(this.orgOf(user)) };
  }

  @RequirePermissions("can_create_roles")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(idResponseSchema)
  async create(
    @Body(zodBody(createRoleInputSchema)) dto: CreateRoleInput,
    @CurrentUser() user: RequestUser,
  ): Promise<IdResponse> {
    return this.roles.create(
      this.orgOf(user),
      { id: user.id, email: user.email },
      {
        name: dto.name,
        description: dto.description,
        color: dto.color,
        baseRole: dto.baseRole,
        permissions: dto.permissions,
      },
    );
  }

  @RequirePermissions("can_edit_roles")
  @Patch(":id")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async update(
    @Param(zodParams(roleIdParamSchema)) { id }: RoleIdParam,
    @Body(zodBody(updateRoleInputSchema)) dto: UpdateRoleInput,
    @CurrentUser() user: RequestUser,
  ): Promise<OkResponse> {
    await this.roles.update(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
      dto,
    );
    return { ok: true };
  }

  @RequirePermissions("can_delete_roles")
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async remove(
    @Param(zodParams(roleIdParamSchema)) { id }: RoleIdParam,
    @CurrentUser() user: RequestUser,
  ): Promise<OkResponse> {
    await this.roles.remove(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
    );
    return { ok: true };
  }

  /** The permission-matrix screen reads this. */
  @RequirePermissions("can_view_roles")
  @Get("overrides")
  @ZodResponse(roleOverridesResponseSchema)
  async overrides(
    @CurrentUser() user: RequestUser,
  ): Promise<RoleOverridesResponse> {
    return roleOverridesResponseSchema.parse({
      overrides: await this.roles.overrides(this.orgOf(user)),
    });
  }

  /**
   * Set an organization's overrides for one base role.
   *
   * `can_edit_organization` rather than `can_edit_roles`: these change what
   * EVERY member of a base role can do, which is a heavier act than editing one
   * named role — and in the default presets only an owner holds that key.
   */
  @RequirePermissions("can_edit_organization")
  @Put("overrides")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async setOverride(
    @Body(zodBody(setRoleOverrideInputSchema)) dto: SetRoleOverrideInput,
    @CurrentUser() user: RequestUser,
  ): Promise<OkResponse> {
    await this.roles.setOverride(
      this.orgOf(user),
      { id: user.id, email: user.email },
      dto.baseRole,
      dto.permissions,
    );
    return { ok: true };
  }
}
