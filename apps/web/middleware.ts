import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

import {
  decideRoute,
  type RouteDecision,
  type TokenState,
} from "./app/_features/session/route-session-state";

export type { TokenState } from "./app/_features/session/route-session-state";

/**
 * Route protection.
 *
 * The access token is verified LOCALLY against `SUPABASE_JWT_SECRET` — no
 * network call per navigation. apps/api signs nothing itself; it hands through
 * Supabase's token, so both tiers verify against the same secret. If they ever
 * disagree, every request 401s and neither log says why, which is why both
 * processes print a fingerprint of the secret at boot for comparison.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *   it never calls the API to check a session. A middleware that makes a network
 *   request per navigation turns every page transition into a round trip, and
 *   its failure mode is signing everyone out when the API hiccups.
 */

const PROTECTED = [
  "/dashboard",
  "/management",
  "/organization",
  "/products",
  "/connectors",
  "/account",
  "/security",
  "/roles",
  "/permissions",
  "/onboarding",
];

const AUTH_PAGES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify",
  "/check-email",
  "/expired",
  "/lock",
  "/two-factor",
  "/success",
];

/** Mid-flow pages an authenticated-but-incomplete user must still reach. */
const AUTH_FLOW_EXCEPTIONS = ["/verify", "/two-factor", "/lock", "/success"];

const ACCESS_COOKIE = "cra_at";
const SESSION_MARKER_COOKIE = "cra_session";
const PENDING_COOKIE = "cra_pending";
const MFA_COOKIE = "cra_mfa";

/**
 * Mocks are opt-OUT (`!== "false"`), matching providers.tsx and
 * instrumentation.ts. While they are on there is no API and no database, so
 * gating /dashboard would bounce every developer's first `pnpm dev` to a
 * sign-in page served by nothing.
 *
 * The production override is the important half: a dev-only fail-open that
 * leaked into a deployment would silently unprotect the whole dashboard.
 */
const MOCKS_ON = process.env.NEXT_PUBLIC_ENABLE_MOCKS !== "false";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const GATE_ENABLED = IS_PRODUCTION || !MOCKS_ON;

const secret = process.env.SUPABASE_JWT_SECRET
  ? new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)
  : null;

/**
 * SUPABASE ISSUES ES256 ACCESS TOKENS, NOT HS256 — at least on any project
 * using asymmetric signing keys, which is the default for new ones. A shared
 * `SUPABASE_JWT_SECRET` cannot verify those at all.
 *
 * This was not knowable until the stack ran: an HS256-only middleware happily
 * verified nothing, classified every real session as `invalid`, and bounced the
 * user to /sign-in immediately after a SUCCESSFUL sign-in. The API's verifier
 * resolves the algorithm per token for the same reason, and logs which one it
 * settled on at boot.
 *
 * `createRemoteJWKSet` caches the key set and handles rotation, so this is one
 * fetch per Edge isolate rather than one per navigation.
 */
const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "http://127.0.0.1:54321"
).replace(/\/+$/, "");

const jwks = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

export async function inspectToken(
  token: string | undefined,
): Promise<TokenState> {
  if (!token) return "absent";

  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return "invalid";
  }

  // Reject before selecting a verifier or an outage fallback. Otherwise an
  // unsupported algorithm could be mistaken for an asymmetric Supabase token
  // and accepted from its unsigned expiry when JWKS lookup fails.
  if (alg !== "HS256" && alg !== "ES256" && alg !== "RS256") {
    return "invalid";
  }

  const useJwks = alg !== "HS256";

  /*
   * HS256 with no secret configured: fall back to reading `exp` only. That is
   * enough to decide whether to attempt a refresh, and it is never the sole
   * gate — the API verifies properly on the very next call. Lenient here,
   * strict there, so a missing env var does not make local setup mysteriously
   * broken.
   */
  if (!useJwks && !secret) return readExpiry(token);

  try {
    if (useJwks) {
      await jwtVerify(token, jwks, { issuer: `${SUPABASE_URL}/auth/v1` });
    } else {
      await jwtVerify(token, secret!);
    }
    return "valid";
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_JWT_EXPIRED") return "expired";

    /*
     * A JWKS fetch failure is OUR outage, not a bad token. Treating it as
     * `invalid` would sign every user out because one network call failed, so
     * fall back to the expiry read and let the API make the real decision.
     */
    if (
      useJwks &&
      (code === "ERR_JWKS_TIMEOUT" ||
        code === "ERR_JWKS_NO_MATCHING_KEY" ||
        code === "ERR_JOSE_GENERIC")
    ) {
      return readExpiry(token);
    }

    return "invalid";
  }
}

/** Unsigned `exp` read. Used only for the no-secret fallback. */
function readExpiry(token: string): TokenState {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return "invalid";

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    if (!payload.exp) return "valid";
    return payload.exp > Math.floor(Date.now() / 1000) ? "valid" : "expired";
  } catch {
    return "invalid";
  }
}

const startsWithAny = (path: string, prefixes: string[]): boolean =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/** Builds a same-origin refresh navigation so host-only cookies are included. */
export function createRefreshTarget(request: NextRequest): URL {
  const target = request.nextUrl.clone();
  target.pathname = "/api/v1/auth/refresh";
  target.search = "";
  target.searchParams.set(
    "redirectTo",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return target;
}

export function shouldAttemptRefresh(
  isProtected: boolean,
  state: TokenState,
  hasSessionMarker: boolean,
): boolean {
  return (
    decideRoute({
      protected: isProtected,
      authPage: false,
      flowException: false,
      verificationPage: false,
      mfaPage: false,
      token: state,
      marker: hasSessionMarker,
      pending: false,
      mfa: false,
    }).kind === "refresh"
  );
}

function redirectTo(request: NextRequest, pathname: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

function respondToDecision(
  request: NextRequest,
  decision: RouteDecision,
  returnUrl: string,
): NextResponse {
  switch (decision.kind) {
    case "refresh":
      // Only navigations are bounced. `/api/v1` is excluded by the matcher.
      return NextResponse.redirect(createRefreshTarget(request));
    case "sign_in": {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = "";
      url.searchParams.set("returnUrl", returnUrl);
      return NextResponse.redirect(url);
    }
    case "clear_and_sign_in": {
      const response = redirectTo(request, "/sign-in");
      response.cookies.delete(ACCESS_COOKIE);
      return response;
    }
    case "verify_email":
      return redirectTo(request, "/verify");
    case "verify_mfa":
      return redirectTo(request, "/two-factor");
    case "dashboard":
      return redirectTo(request, "/dashboard");
    case "next":
      return NextResponse.next();
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (!GATE_ENABLED) return NextResponse.next();

  const isProtected = startsWithAny(pathname, PROTECTED);
  const isAuthPage = startsWithAny(pathname, AUTH_PAGES);
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const state = await inspectToken(token);
  const hasSessionMarker = request.cookies.has(SESSION_MARKER_COOKIE);
  const pending = request.cookies.get(PENDING_COOKIE)?.value;
  const mfa = request.cookies.get(MFA_COOKIE)?.value;
  const decision = decideRoute({
    protected: isProtected,
    authPage: isAuthPage,
    flowException: startsWithAny(pathname, AUTH_FLOW_EXCEPTIONS),
    verificationPage: pathname.startsWith("/verify"),
    mfaPage: pathname.startsWith("/two-factor"),
    token: state,
    marker: hasSessionMarker,
    pending: Boolean(pending),
    mfa: Boolean(mfa),
  });
  return respondToDecision(request, decision, `${pathname}${search}`);
}

export const config = {
  /*
   * `api/v1` is excluded so a proxied XHR is never redirected — see the note on
   * rule 1. Static assets and the MSW worker are excluded because middleware on
   * every asset is pure latency, and rewriting the worker script would break
   * mocking entirely.
   */
  matcher: [
    "/((?!api/v1|_next/static|_next/image|favicon.ico|mockServiceWorker.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
