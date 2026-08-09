import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { BaseRole, PermissionKey } from "@repo/contracts/permissions";
import { BASE_ROLE_RANK } from "@repo/contracts/permissions";

import { PermissionsService } from "../permissions/permissions.service";
import {
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  type AuthedRequest,
} from "./auth.types";

/**
 * Enforces `@RequirePermissions()` and `@RequireRole()`.
 *
 * Registered globally but NO-OPS without metadata, so adding it changed the
 * behaviour of exactly zero existing routes. That is what makes it safe to make
 * global; `permission-coverage.spec.ts` then requires every non-self-scoped
 * route to carry a decorator, so "no metadata" cannot quietly become the norm.
 *
 * Runs AFTER SupabaseAuthGuard, so `request.user` is populated.
 *
 * 403, NOT 404. Hiding the existence of a resource behind a not-found is
 * sometimes right, but here the caller is a known, authenticated member of the
 * organization: telling them they lack a permission is actionable, and pretending
 * the page does not exist just generates support tickets.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredRole = this.reflector.getAllAndOverride<BaseRole>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length && !requiredRole) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;

    // No user means SupabaseAuthGuard let this through as @Public(). A public
    // route carrying a permission requirement is a contradiction, so refuse
    // rather than silently allowing it.
    if (!user) {
      throw new ForbiddenException({
        message: "You do not have access to this.",
        code: "forbidden",
      });
    }

    if (!user.organizationId || !user.role) {
      throw new ForbiddenException({
        message: "You are not a member of any organization.",
        code: "no_organization",
      });
    }

    if (requiredRole) {
      const rank = BASE_ROLE_RANK[user.role];
      if (rank < BASE_ROLE_RANK[requiredRole]) {
        throw new ForbiddenException({
          message: "You do not have access to this.",
          code: "insufficient_role",
        });
      }
    }

    if (required?.length) {
      const ok = await this.permissions.can(
        user.organizationId,
        user.id,
        user.role,
        required,
      );
      if (!ok) {
        throw new ForbiddenException({
          message: "You do not have access to this.",
          code: "insufficient_permissions",
        });
      }
    }

    return true;
  }
}
