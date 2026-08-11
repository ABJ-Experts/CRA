import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Reflector } from "@nestjs/core";

import type { MfaService } from "./mfa/mfa.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import type { SupabaseService } from "../supabase/supabase.service";
import type { TokenVerifierService } from "./token-verifier.service";

const profile = (emailVerifiedAt: string | null) => ({
  id: "profile-1",
  auth_user_id: "auth-1",
  email: "person@example.com",
  is_active: true,
  session_epoch_at: "2020-01-01T00:00:00.000Z",
  email_verified_at: emailVerifiedAt,
});

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createGuard(options: {
  aal?: "aal1" | "aal2";
  emailVerifiedAt?: string | null;
  hasVerifiedFactor?: boolean;
}) {
  const users = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
  };
  users.select.mockReturnValue(users);
  users.eq.mockReturnValue(users);
  users.maybeSingle.mockResolvedValue({
    data: profile(
      "emailVerifiedAt" in options
        ? options.emailVerifiedAt!
        : "2026-01-01T00:00:00.000Z",
    ),
    error: null,
  });

  const memberships = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
  };
  memberships.select.mockReturnValue(memberships);
  memberships.eq.mockReturnValue(memberships);
  memberships.order.mockResolvedValue({ data: [], error: null });

  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const tokens = {
    verify: jest.fn().mockResolvedValue({
      ok: true,
      claims: { sub: "auth-1", iat: 1_800_000_000, aal: options.aal ?? "aal1" },
    }),
  } as unknown as TokenVerifierService;
  const supabase = {
    admin: () => ({
      from: (table: string) => (table === "users" ? users : memberships),
    }),
  } as unknown as SupabaseService;
  const config = {
    getOrThrow: (key: string) =>
      key === "COOKIE_SIGNING_SECRET" ? "test-cookie-secret" : 5,
  } as unknown as ConfigService;
  const hasVerifiedFactor = jest
    .fn()
    .mockResolvedValue(options.hasVerifiedFactor ?? false);
  const mfa = {
    hasVerifiedFactor,
  } as unknown as MfaService;

  return {
    guard: new SupabaseAuthGuard(reflector, tokens, supabase, config, mfa, {
      authorize: jest.fn().mockResolvedValue({ outcome: "allowed" }),
    }),
    hasVerifiedFactor,
  };
}

describe("SupabaseAuthGuard server-side gates", () => {
  const request = {
    cookies: { cra_at: "access-token" },
    headers: {},
  };

  it("rejects an unverified email even when the pending browser cookie was deleted", async () => {
    const { guard, hasVerifiedFactor } = createGuard({ emailVerifiedAt: null });

    try {
      await guard.canActivate(context(request));
      fail("expected the unverified account to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: "email_verification_required",
      });
    }
    expect(hasVerifiedFactor).not.toHaveBeenCalled();
  });

  it("rejects aal1 when a verified factor exists even when the MFA browser cookie was deleted", async () => {
    const { guard } = createGuard({ hasVerifiedFactor: true, aal: "aal1" });

    try {
      await guard.canActivate(context(request));
      fail("expected the aal1 session to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: "mfa_required",
      });
    }
  });

  it("allows aal2 sessions for accounts with a verified factor", async () => {
    const { guard } = createGuard({ hasVerifiedFactor: true, aal: "aal2" });

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
  });
});
