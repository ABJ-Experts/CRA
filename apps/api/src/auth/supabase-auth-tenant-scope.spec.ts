import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Reflector } from "@nestjs/core";

import { ALLOW_TENANT_RECOVERY_KEY, type AuthedRequest } from "./auth.types";
import { ACTIVE_ORG_COOKIE, sign } from "./cookies.util";
import type { MfaService } from "./mfa/mfa.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import type { SupabaseService } from "../supabase/supabase.service";
import type { TokenVerifierService } from "./token-verifier.service";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";

function context(request: AuthedRequest): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function harness(
  options: {
    allowRecovery?: boolean;
    accessOutcome?: string;
    claimedIssuedAt?: unknown;
    claimedSessionId?: string;
    memberships?: readonly Readonly<{
      organization_id: string;
      role: string;
    }>[];
    activeOrganizationIds?: readonly string[];
  } = {},
) {
  const users = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: {
        id: userId,
        auth_user_id: "00000000-0000-4000-8000-000000000004",
        email: "owner@cra.test",
        is_active: true,
        email_verified_at: "2026-08-10T00:00:00.000Z",
        session_epoch_at: "2026-08-09T00:00:00.000Z",
      },
      error: null,
    }),
  };
  const memberships = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({
      data: options.memberships ?? [
        { organization_id: organizationId, role: "owner" },
      ],
      error: null,
    }),
  };
  const lifecycles = {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockResolvedValue({
      data: (options.activeOrganizationIds ?? [organizationId]).map(
        (activeOrganizationId) => ({
          organization_id: activeOrganizationId,
          status: "active",
        }),
      ),
      error: null,
    }),
  };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ALLOW_TENANT_RECOVERY_KEY
        ? options.allowRecovery === true
          ? "lifecycle recovery test"
          : undefined
        : false,
    ),
  } as unknown as Reflector;
  const tokens = {
    verify: jest.fn().mockResolvedValue({
      ok: true,
      claims: {
        sub: "00000000-0000-4000-8000-000000000004",
        iat: options.claimedIssuedAt ?? 1_786_363_200,
        aal: "aal2",
        session_id: options.claimedSessionId ?? sessionId,
      },
    }),
  } as unknown as TokenVerifierService;
  const supabase = {
    admin: () => ({
      from: (table: string) =>
        table === "users"
          ? users
          : table === "organization_members"
            ? memberships
            : lifecycles,
    }),
  } as unknown as SupabaseService;
  const tenantAccess = {
    authorize: jest
      .fn()
      .mockResolvedValue({ outcome: options.accessOutcome ?? "allowed" }),
  };
  const guard = new SupabaseAuthGuard(
    reflector,
    tokens,
    supabase,
    {
      getOrThrow: (key: string) =>
        key === "COOKIE_SIGNING_SECRET" ? "test-cookie-secret" : 0,
    } as unknown as ConfigService,
    {
      hasVerifiedFactor: jest.fn().mockResolvedValue(false),
    } as unknown as MfaService,
    tenantAccess,
  );
  return { guard, tenantAccess };
}

describe("SupabaseAuthGuard tenant scope", () => {
  it("registers a valid JWT session id and attaches it to RequestUser", async () => {
    const { guard, tenantAccess } = harness();
    const request = {
      cookies: { cra_at: "access-token" },
      headers: {},
    } as unknown as AuthedRequest;

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(tenantAccess.authorize).toHaveBeenCalledWith({
      organizationId,
      userId,
      sessionId,
      issuedAt: "2026-08-10T12:00:00.000Z",
      allowRecovery: false,
    });
    expect(request.user?.sessionId).toBe(sessionId);
  });

  it("passes the reasoned recovery exemption only to the tenant access port", async () => {
    const { guard, tenantAccess } = harness({ allowRecovery: true });
    const request = {
      cookies: { cra_at: "access-token" },
      headers: {},
    } as unknown as AuthedRequest;

    await guard.canActivate(context(request));

    expect(tenantAccess.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ allowRecovery: true }),
    );
  });

  it("falls back to an active membership instead of letting a signed inactive org lock out another tenant", async () => {
    const inactiveOrganizationId = "00000000-0000-4000-8000-000000000010";
    const activeOrganizationId = "00000000-0000-4000-8000-000000000011";
    const { guard, tenantAccess } = harness({
      memberships: [
        { organization_id: inactiveOrganizationId, role: "owner" },
        { organization_id: activeOrganizationId, role: "member" },
      ],
      activeOrganizationIds: [activeOrganizationId],
    });
    const request = {
      cookies: {
        cra_at: "access-token",
        [ACTIVE_ORG_COOKIE]: sign(inactiveOrganizationId, "test-cookie-secret"),
      },
      headers: {},
    } as unknown as AuthedRequest;

    await expect(guard.canActivate(context(request))).resolves.toBe(true);

    expect(tenantAccess.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: activeOrganizationId }),
    );
  });

  it("keeps the signed inactive membership only for a reasoned recovery route", async () => {
    const inactiveOrganizationId = "00000000-0000-4000-8000-000000000010";
    const activeOrganizationId = "00000000-0000-4000-8000-000000000011";
    const { guard, tenantAccess } = harness({
      allowRecovery: true,
      memberships: [
        { organization_id: inactiveOrganizationId, role: "owner" },
        { organization_id: activeOrganizationId, role: "member" },
      ],
      activeOrganizationIds: [activeOrganizationId],
    });
    const request = {
      cookies: {
        cra_at: "access-token",
        [ACTIVE_ORG_COOKIE]: sign(inactiveOrganizationId, "test-cookie-secret"),
      },
      headers: {},
    } as unknown as AuthedRequest;

    await expect(guard.canActivate(context(request))).resolves.toBe(true);

    expect(tenantAccess.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: inactiveOrganizationId,
        allowRecovery: true,
      }),
    );
  });

  it("blocks inactive tenant scope without revoking the global user session", async () => {
    const { guard } = harness({ accessOutcome: "inactive" });
    const request = {
      cookies: { cra_at: "access-token" },
      headers: {},
    } as unknown as AuthedRequest;

    await expect(guard.canActivate(context(request))).rejects.toMatchObject({
      response: { code: "organization_inactive" },
      status: 403,
    });
  });

  it("never attaches or registers a malformed JWT session id", async () => {
    const { guard, tenantAccess } = harness({
      claimedSessionId: "browser-session",
    });
    const request = {
      cookies: { cra_at: "access-token" },
      headers: {},
    } as unknown as AuthedRequest;

    await expect(guard.canActivate(context(request))).rejects.toMatchObject({
      response: { code: "organization_session_invalid" },
      status: 403,
    });
    expect(tenantAccess.authorize).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });

  it("requires a finite JWT issued-at claim for tenant sessions", async () => {
    const { guard, tenantAccess } = harness({
      claimedIssuedAt: "not-a-number",
    });
    const request = {
      cookies: { cra_at: "access-token" },
      headers: {},
    } as unknown as AuthedRequest;

    await expect(guard.canActivate(context(request))).rejects.toMatchObject({
      response: { code: "organization_session_invalid" },
      status: 403,
    });
    expect(tenantAccess.authorize).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", "organization_session_revoked", 403],
    ["expired", "organization_session_expired", 403],
    ["not_found", "organization_not_found", 403],
    ["unavailable", "organization_unavailable", 503],
    ["malformed", "organization_unavailable", 503],
  ] as const)(
    "maps tenant access outcome %s without attaching RequestUser",
    async (outcome, code, status) => {
      const { guard } = harness({ accessOutcome: outcome });
      const request = {
        cookies: { cra_at: "access-token" },
        headers: {},
      } as unknown as AuthedRequest;

      await expect(guard.canActivate(context(request))).rejects.toMatchObject({
        response: { code },
        status,
      });
      expect(request.user).toBeUndefined();
    },
  );

  it.each([
    ["GET lifecycle", "revoked", "organization_session_revoked"],
    [
      "POST lifecycle/reauthentication",
      "expired",
      "organization_session_expired",
    ],
  ] as const)(
    "rejects an active %s request when its normal tenant session is %s",
    async (_route, outcome, code) => {
      const { guard, tenantAccess } = harness({
        allowRecovery: true,
        accessOutcome: outcome,
      });
      const request = {
        cookies: { cra_at: "access-token" },
        headers: {},
      } as unknown as AuthedRequest;

      await expect(guard.canActivate(context(request))).rejects.toMatchObject({
        response: { code },
        status: 403,
      });
      expect(tenantAccess.authorize).toHaveBeenCalledWith(
        expect.objectContaining({ allowRecovery: true }),
      );
      expect(request.user).toBeUndefined();
    },
  );
});
