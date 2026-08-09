import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { coerceBaseRole } from "@repo/contracts/permissions";

import { SupabaseService } from "../supabase/supabase.service";
import { ACCESS_COOKIE, ACTIVE_ORG_COOKIE, unsign } from "./cookies.util";
import { MfaService } from "./mfa/mfa.service";
import {
  ALLOW_MFA_PENDING_KEY,
  IS_PUBLIC_KEY,
  type AuthedRequest,
  type RequestUser,
} from "./auth.types";
import { TokenVerifierService } from "./token-verifier.service";

interface ProfileRow {
  id: string;
  // Nullable in the schema: an invited-but-unaccepted profile has no auth
  // identity yet. The generated types caught this — the guard only ever reads
  // it for a row it just matched BY auth_user_id, so it is non-null in practice,
  // but the type must tell the truth.
  auth_user_id: string | null;
  email: string;
  is_active: boolean;
  email_verified_at: string | null;
  session_epoch_at: string;
}

interface MembershipRow {
  organization_id: string;
  role: string;
}

/**
 * The global authentication guard. Registered as APP_GUARD, so every route is
 * protected unless it carries `@Public()`.
 *
 * Deny-by-default is the whole point: the reference decorates 97 controllers
 * individually with `@UseGuards`, which means a forgotten decorator is a
 * silently public endpoint. Here a forgotten decorator is a 401.
 *
 * 401 vs 503 IS A REAL DISTINCTION, not pedantry. If Supabase or the JWKS
 * endpoint is unreachable, that is our outage — answering 401 would sign every
 * user out of a perfectly healthy session because one network call failed.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);
  private readonly signingSecret: string;
  private readonly epochSkewSeconds: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenVerifierService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly mfa: MfaService,
  ) {
    this.signingSecret = this.config.getOrThrow<string>(
      "COOKIE_SIGNING_SECRET",
    );
    this.epochSkewSeconds = this.config.getOrThrow<number>(
      "SESSION_EPOCH_SKEW_SECONDS",
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException({
        message: "You are not signed in.",
        code: "no_session",
      });
    }

    // ---- 1. Signature and expiry -----------------------------------------
    const verified = await this.tokens.verify(token);

    if (!verified.ok) {
      if (verified.reason === "unavailable") {
        throw new ServiceUnavailableException({
          message: "Sign-in is temporarily unavailable. Please try again.",
          code: "auth_unavailable",
        });
      }
      throw new UnauthorizedException({
        message: "Your session has expired. Please sign in again.",
        code: verified.reason === "expired" ? "token_expired" : "token_invalid",
      });
    }

    const claims = verified.claims;
    const authUserId = claims.sub;

    if (!authUserId) {
      throw new UnauthorizedException({
        message: "Your session is not valid.",
        code: "token_invalid",
      });
    }

    // ---- 2. Profile -------------------------------------------------------
    const profile = await this.loadProfile(authUserId);

    if (!profile) {
      /*
       * A valid JWT with no public.users row. This is exactly what the
       * on_auth_user_created trigger exists to prevent, and the reference spent
       * real time on it: without the trigger every brand-new sign-up gets a
       * working token and then 401s here, which reads as "login is broken"
       * rather than "a row is missing".
       */
      this.logger.error(
        `No profile for auth user ${authUserId} — the on_auth_user_created trigger may be missing`,
      );
      throw new UnauthorizedException({
        message: "Your account is not set up. Please contact support.",
        code: "profile_missing",
      });
    }

    // ---- 3. Deactivation --------------------------------------------------
    if (!profile.is_active) {
      // A signature stays valid for its full lifetime, so a soft-deleted user
      // keeps working access until this check exists.
      throw new UnauthorizedException({
        message: "This account has been deactivated.",
        code: "account_inactive",
      });
    }

    // ---- 4. Email verification --------------------------------------------
    // This is stored server-side. `cra_pending` only keeps the browser on the
    // verification screen; deleting it must never turn an unverified session
    // into an authenticated one.
    if (!profile.email_verified_at) {
      throw new UnauthorizedException({
        message: "Verify your email address before continuing.",
        code: "email_verification_required",
      });
    }

    // ---- 5. Session revocation epoch --------------------------------------
    this.assertNotRevoked(claims.iat, profile.session_epoch_at);

    // ---- 6. MFA gate ------------------------------------------------------
    const allowMfaPending = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MFA_PENDING_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      !allowMfaPending &&
      (await this.mfa.hasVerifiedFactor(token)) &&
      claims.aal !== "aal2"
    ) {
      throw new UnauthorizedException({
        message: "Two-factor verification is required.",
        code: "mfa_required",
      });
    }

    // ---- 7. Organization scope -------------------------------------------
    const membership = await this.resolveMembership(request, profile.id);

    const user: RequestUser = {
      id: profile.id,
      // From the verified claim, not the column. The row was matched BY
      // auth_user_id so the two agree, but the claim is non-null by
      // construction whereas the column is nullable — and `?? ""` here would
      // hand GoTrue an empty id at some later call site.
      authUserId,
      email: profile.email,
      isActive: profile.is_active,
      organizationId: membership?.organization_id ?? null,
      role: membership ? coerceBaseRole(membership.role) : null,
      accessToken: token,
      aal: typeof claims.aal === "string" ? claims.aal : null,
    };

    request.user = user;
    return true;
  }

  /**
   * Cookie first, then bearer.
   *
   * Browsers use the HttpOnly cookie. The Authorization header exists for
   * server-to-server callers and for tests, which cannot easily hold a cookie
   * jar. Cookie takes precedence so a stale header cannot override a live
   * session.
   */
  private extractToken(request: AuthedRequest): string | null {
    const cookies = request.cookies as Record<string, string> | undefined;
    const fromCookie = cookies?.[ACCESS_COOKIE];
    if (fromCookie) return fromCookie;

    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;

    return null;
  }

  /**
   * Reject a token minted before the account's session epoch.
   *
   * The skew allowance is not optional. `iat` comes from GoTrue's clock and
   * `session_epoch_at` from Postgres's, and inside Docker they drift by a second
   * or two. Without the allowance, changing your password immediately signs you
   * out of the session you just authenticated with — the epoch is bumped by the
   * password change, and the token you are holding was issued moments earlier.
   */
  private assertNotRevoked(iat: number | undefined, epochIso: string): void {
    if (iat === undefined) return;

    const epochSeconds = Math.floor(new Date(epochIso).getTime() / 1000);
    if (!Number.isFinite(epochSeconds)) return;

    if (iat < epochSeconds - this.epochSkewSeconds) {
      throw new UnauthorizedException({
        message: "Your session has ended. Please sign in again.",
        code: "session_revoked",
      });
    }
  }

  private async loadProfile(authUserId: string): Promise<ProfileRow | null> {
    const { data, error } = await this.supabase
      .admin()
      .from("users")
      .select(
        "id, auth_user_id, email, is_active, email_verified_at, session_epoch_at",
      )
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error) {
      this.logger.error(`Profile lookup failed: ${error.message}`);
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    }

    return data;
  }

  /**
   * Which organization is this request about?
   *
   * The signed `cra_org` cookie names one; it is verified against the user's
   * actual memberships before being trusted, so tampering with the cookie
   * cannot scope a request to somebody else's organization. When it is absent
   * or no longer valid, fall back to the user's oldest membership so a request
   * is never left unscoped.
   */
  private async resolveMembership(
    request: AuthedRequest,
    userId: string,
  ): Promise<MembershipRow | null> {
    const { data, error } = await this.supabase
      .admin()
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      this.logger.error(`Membership lookup failed: ${error.message}`);
      throw new ServiceUnavailableException({
        message: "Sign-in is temporarily unavailable. Please try again.",
        code: "auth_unavailable",
      });
    }

    const memberships = data ?? [];
    if (memberships.length === 0) return null;

    const cookies = request.cookies as Record<string, string> | undefined;
    const requested = unsign(cookies?.[ACTIVE_ORG_COOKIE], this.signingSecret);

    if (requested) {
      const match = memberships.find((m) => m.organization_id === requested);
      // Silently falling back rather than 403-ing is deliberate: losing access
      // to an organization is a normal event (removed from a team), and it
      // should drop you to another one, not lock you out of the whole app.
      if (match) return match;
    }

    return memberships[0] ?? null;
  }
}
