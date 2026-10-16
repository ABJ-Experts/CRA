import { createParamDecorator, SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { BaseRole, PermissionKey } from "@repo/contracts/permissions";

/**
 * What the guard attaches to the request.
 *
 * `id` and `authUserId` are named distinctly on purpose. They are BOTH uuids
 * and they are NOT the same value: `id` is `public.users.id`, which every
 * foreign key in the schema points at, while `authUserId` is `auth.users.id`,
 * which only GoTrue cares about. Confusing them produces membership rows that
 * reference an identity nothing else joins to — a bug that stays invisible
 * until a JOIN silently returns nothing.
 */
export interface RequestUser {
  /** public.users.id — use this for every FK. */
  id: string;
  /** auth.users.id — use this only when talking to GoTrue. */
  authUserId: string;
  email: string;
  isActive: boolean;
  /** The organization this request is scoped to, if one is resolvable. */
  organizationId: string | null;
  /** Base role within that organization. */
  role: BaseRole | null;
  /** Raw access token, for calls that must be made AS the user. */
  accessToken: string;
  /** Assurance level from the JWT: 'aal1' | 'aal2'. */
  aal: string | null;
  /** Verified Supabase JWT session_id, present only when it is a valid UUID. */
  sessionId?: string;
}

export interface AuthedRequest extends Request {
  user?: RequestUser;
}

/**
 * Opts a route out of the global auth guard.
 *
 * The guard is registered globally and denies by default, so a new endpoint is
 * protected because of where it lives rather than because someone remembered a
 * decorator. `@Public()` makes the exception explicit and greppable, and
 * `public-routes.spec.ts` asserts the full set against a hand-written allowlist
 * so one cannot be added without a reviewer seeing it.
 */
export const IS_PUBLIC_KEY = "auth:isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Routes reachable while a session still owes an MFA challenge.
 *
 * Without this the TOTP verification endpoint itself would be unreachable: the
 * guard would reject the aal1 session that is trying to become aal2.
 */
export const ALLOW_MFA_PENDING_KEY = "auth:allowMfaPending";
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING_KEY, true);

/** Injects the authenticated user, or a single field of it. */
export const CurrentUser = createParamDecorator(
  (field: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);

/**
 * Requires ALL listed permissions. Keyed against the union from
 * `@repo/contracts`, so a typo is a compile error rather than a check that
 * silently never passes.
 */
export const REQUIRE_PERMISSIONS_KEY = "auth:requirePermissions";
export const RequirePermissions = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, keys);

/** Requires the caller's base role to be at least the given rank. */
export const REQUIRE_ROLE_KEY = "auth:requireRole";
export const RequireRole = (role: BaseRole) =>
  SetMetadata(REQUIRE_ROLE_KEY, role);

/**
 * Marks a route as scoped to the caller's own data, so `permission-coverage.spec.ts`
 * accepts it without a permission decorator. Requires a written reason — an
 * exemption nobody had to justify is one nobody will revisit.
 */
export const SELF_SCOPED_KEY = "auth:selfScoped";
export const SelfScoped = (reason: string) =>
  SetMetadata(SELF_SCOPED_KEY, reason);

/**
 * Allows only the lifecycle recovery entry points to inspect an inactive
 * signed tenant scope. The tenant access repository still re-verifies owner
 * membership; ordinary tenant routes never receive this exemption.
 */
export const ALLOW_TENANT_RECOVERY_KEY = "auth:allowTenantRecovery";
export const AllowTenantRecovery = (reason: string) =>
  SetMetadata(ALLOW_TENANT_RECOVERY_KEY, reason);
