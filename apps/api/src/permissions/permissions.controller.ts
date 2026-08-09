import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import type {
  BaseRole,
  PermissionKey,
  PermissionSet,
} from "@repo/contracts/permissions";
import { PERMISSION_KEYS, isPermissionKey } from "@repo/contracts/permissions";
import type { MenuKey } from "@repo/contracts/menu";
import { z } from "zod";

import { zodBody } from "../common/pipes/zod-validation.pipe";
import { CurrentUser, SelfScoped } from "../auth/auth.types";
import { PermissionsService } from "./permissions.service";

const checkSchema = z.object({
  permissions: z.array(z.string()).min(1).max(50),
});

/**
 * What the web app reads to decide what to render.
 *
 * Every route here is SELF-scoped: it reports the CALLER's own permissions and
 * nothing else. That is why none of them carries `@RequirePermissions` — asking
 * "what may I do?" cannot itself require a permission, or a user with none
 * could never load the app at all.
 */
@Controller("permissions")
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * The caller's full effective permission set.
   *
   * Sent whole rather than as a list of granted keys so the client can
   * distinguish "denied" from "unknown" — it never has to guess whether an
   * absent key means no or not-loaded-yet.
   */
  @SelfScoped("Reports only the caller's own permissions.")
  @Get("effective")
  async effective(
    @CurrentUser("organizationId") orgId: string | null,
    @CurrentUser("id") userId: string,
    @CurrentUser("role") role: BaseRole | null,
  ): Promise<{
    organizationId: string | null;
    role: BaseRole | null;
    permissions: PermissionSet;
  }> {
    if (!orgId || !role) {
      // Not a member of anything yet — an empty set rather than an error, so the
      // app can render a "you have no organization" state instead of crashing.
      return { organizationId: null, role: null, permissions: {} };
    }

    const { permissions } = await this.permissions.resolve(orgId, userId, role);
    return { organizationId: orgId, role, permissions };
  }

  /** Which nav entries to render. */
  @SelfScoped("Reports only the caller's own menu visibility.")
  @Get("menu")
  async menu(
    @CurrentUser("organizationId") orgId: string | null,
    @CurrentUser("id") userId: string,
    @CurrentUser("role") role: BaseRole | null,
  ): Promise<{ menu: MenuKey[] }> {
    if (!orgId || !role) return { menu: [] };
    return { menu: await this.permissions.menu(orgId, userId, role) };
  }

  /** Batch check, for a client deciding several things at once. */
  @SelfScoped("Checks only the caller's own permissions.")
  @Post("check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Body(zodBody(checkSchema)) dto: { permissions: string[] },
    @CurrentUser("organizationId") orgId: string | null,
    @CurrentUser("id") userId: string,
    @CurrentUser("role") role: BaseRole | null,
  ): Promise<{ results: Record<string, boolean> }> {
    if (!orgId || !role)
      throw new ForbiddenException({
        message: "You are not a member of any organization.",
        code: "no_organization",
      });

    // Unknown keys resolve to false rather than erroring: a client asking about
    // a permission that has since been deleted should be told "no", not 400.
    const known = dto.permissions.filter(isPermissionKey);
    const { permissions } = await this.permissions.resolve(orgId, userId, role);

    const results: Record<string, boolean> = {};
    for (const key of dto.permissions) {
      results[key] = known.includes(key as PermissionKey)
        ? permissions[key as PermissionKey] === true
        : false;
    }
    return { results };
  }

  /** The full catalogue, for the admin matrix screen. */
  @SelfScoped("Static catalogue of permission keys; reveals no data.")
  @Get("catalogue")
  catalogue(): { permissions: readonly PermissionKey[] } {
    return { permissions: PERMISSION_KEYS };
  }
}
