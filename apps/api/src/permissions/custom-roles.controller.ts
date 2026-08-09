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
import { BASE_ROLES, type PermissionSet } from "@repo/contracts/permissions";
import { z } from "zod";

import { zodBody } from "../common/pipes/zod-validation.pipe";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { CustomRolesService, type CustomRoleRow } from "./custom-roles.service";

// `record(string, boolean)` rather than an enum of every key: unknown keys are
// dropped by sanitizePermissions server-side, so rejecting them here would only
// turn a harmless stale key into a 400 for the whole request.
const permissionsSchema = z.record(z.string(), z.boolean());

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex colour like #4A50D6")
    .optional(),
  baseRole: z.enum(BASE_ROLES).default("member"),
  permissions: permissionsSchema.default({}),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const overrideSchema = z.object({
  baseRole: z.enum(BASE_ROLES),
  permissions: permissionsSchema,
});

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
  async list(
    @CurrentUser() user: RequestUser,
  ): Promise<{ rows: CustomRoleRow[] }> {
    return { rows: await this.roles.list(this.orgOf(user)) };
  }

  @RequirePermissions("can_create_roles")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(zodBody(createSchema)) dto: z.infer<typeof createSchema>,
    @CurrentUser() user: RequestUser,
  ): Promise<{ id: string }> {
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
  async update(
    @Param("id") id: string,
    @Body(zodBody(updateSchema)) dto: z.infer<typeof updateSchema>,
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true }> {
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
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true }> {
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
  async overrides(
    @CurrentUser() user: RequestUser,
  ): Promise<{ overrides: Record<string, PermissionSet> }> {
    return { overrides: await this.roles.overrides(this.orgOf(user)) };
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
  async setOverride(
    @Body(zodBody(overrideSchema)) dto: z.infer<typeof overrideSchema>,
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true }> {
    await this.roles.setOverride(
      this.orgOf(user),
      { id: user.id, email: user.email },
      dto.baseRole,
      dto.permissions,
    );
    return { ok: true };
  }
}
