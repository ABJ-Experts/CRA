import { createHmac, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Response } from "express";

/**
 * The cookie contract between apps/api and apps/web.
 *
 * NestJS sets these; the Next middleware reads and verifies `cra_at` locally on
 * every navigation without a network call. This file is therefore the wire
 * format shared by the two apps — change a name or a path here and the
 * middleware stops seeing the session.
 *
 * WHY HttpOnly
 *   Script on the page cannot read the token, so an XSS cannot exfiltrate the
 *   session. This is the whole reason the backend owns the session rather than
 *   handing tokens to the browser.
 *
 * WHY THE REFRESH COOKIE HAS A NARROW PATH
 *   The browser only sends `cra_rt` to the refresh endpoint itself. Every other
 *   request — including any CSRF attempt against a mutating route — travels
 *   without it. That path restriction is the CSRF control, not an optimisation.
 *
 * WHY SameSite=Lax by default
 *   First-party navigations carry the cookies; a cross-site POST from an
 *   attacker's page does not.
 */

/** Mirrors `app.setGlobalPrefix()` in main.ts. */
export const API_PREFIX = "api/v1";

export const ACCESS_COOKIE = "cra_at";
export const REFRESH_COOKIE = "cra_rt";
/** Signed remember-me preference, available only to auth endpoints. */
export const REMEMBER_ME_COOKIE = "cra_rm";
/** Set between sign-up and email verification; identifies the pending user. */
export const PENDING_COOKIE = "cra_pending";
/** Set when an aal1 session still owes a TOTP challenge. */
export const MFA_COOKIE = "cra_mfa";
/** Signed `${orgId}.${hmac}` — the user's active organization. */
export const ACTIVE_ORG_COOKIE = "cra_org";

/**
 * Derived from the prefix rather than written out, so the two can never drift.
 * If they do, the browser stops sending the refresh token and every session
 * dies silently after one access-token lifetime — a bug that looks like random
 * logouts an hour apart.
 */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth/refresh`;
/** Allows MFA completion to preserve the user's persistence preference. */
export const REMEMBER_ME_COOKIE_PATH = `/${API_PREFIX}/auth`;

export const PENDING_MAX_AGE = 30 * 60; // 30 min to complete email verification
export const MFA_MAX_AGE = 10 * 60;

export interface CookieConfig {
  domain: string;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  accessMaxAge: number;
  refreshMaxAge: number;
  signingSecret: string;
}

/**
 * Strip CR/LF before anything reaches a Set-Cookie header. Express encodes
 * values, but this is cheap and the failure mode (header injection) is severe
 * enough to be worth belt-and-braces.
 */
function sanitize(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

function base(cfg: CookieConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: cfg.secure,
    sameSite: cfg.sameSite,
    // Omitted ENTIRELY when blank. Setting `domain: 'localhost'` is rejected by
    // some browsers and the cookie is dropped with no error anywhere.
    ...(cfg.domain ? { domain: cfg.domain } : {}),
  };
}

export function setSessionCookies(
  res: Response,
  tokens: { access_token: string; refresh_token: string },
  cfg: CookieConfig,
  opts: { rememberMe?: boolean } = {},
): void {
  res.cookie(ACCESS_COOKIE, sanitize(tokens.access_token), {
    ...base(cfg),
    path: "/",
    maxAge: cfg.accessMaxAge * 1000,
  });

  /*
   * Without "remember me" the refresh cookie is a SESSION cookie (no maxAge):
   * it dies with the browser, so a shared machine does not keep the user signed
   * in for a week. `apps/web`'s sign-in screen already collects this flag and
   * previously passed it to a stub that ignored it.
   */
  res.cookie(REFRESH_COOKIE, sanitize(tokens.refresh_token), {
    ...base(cfg),
    path: REFRESH_COOKIE_PATH,
    ...(opts.rememberMe ? { maxAge: cfg.refreshMaxAge * 1000 } : {}),
  });

  /*
   * A cookie's expiry is never sent back in Cookie headers, so the refresh
   * endpoint cannot otherwise distinguish a persistent login from a
   * session-only login. The MFA endpoints also need it when they replace an
   * aal1 token with an aal2 token, so scope this non-secret marker to auth
   * endpoints rather than the refresh endpoint alone.
   */
  res.cookie(
    REMEMBER_ME_COOKIE,
    sign(opts.rememberMe ? "1" : "0", cfg.signingSecret),
    {
      ...base(cfg),
      path: REMEMBER_ME_COOKIE_PATH,
      ...(opts.rememberMe ? { maxAge: cfg.refreshMaxAge * 1000 } : {}),
    },
  );
}

/** Returns false for absent, malformed, or tampered preference cookies. */
export function readRememberMeCookie(
  cookies: Record<string, string | undefined> | undefined,
  cfg: CookieConfig,
): boolean {
  return unsign(cookies?.[REMEMBER_ME_COOKIE], cfg.signingSecret) === "1";
}

export function clearSessionCookies(res: Response, cfg: CookieConfig): void {
  // The path must match the one used to set it, or the browser keeps the old
  // cookie and the user stays signed in after clicking sign out.
  res.clearCookie(ACCESS_COOKIE, { ...base(cfg), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base(cfg), path: REFRESH_COOKIE_PATH });
  res.clearCookie(REMEMBER_ME_COOKIE, {
    ...base(cfg),
    path: REMEMBER_ME_COOKIE_PATH,
  });
  res.clearCookie(PENDING_COOKIE, { ...base(cfg), path: "/" });
  res.clearCookie(MFA_COOKIE, { ...base(cfg), path: "/" });
}

export function setPendingCookie(
  res: Response,
  userId: string,
  cfg: CookieConfig,
): void {
  res.cookie(PENDING_COOKIE, sign(userId, cfg.signingSecret), {
    ...base(cfg),
    path: "/",
    maxAge: PENDING_MAX_AGE * 1000,
  });
}

export function clearPendingCookie(res: Response, cfg: CookieConfig): void {
  res.clearCookie(PENDING_COOKIE, { ...base(cfg), path: "/" });
}

export function setMfaCookie(
  res: Response,
  userId: string,
  cfg: CookieConfig,
): void {
  res.cookie(MFA_COOKIE, sign(userId, cfg.signingSecret), {
    ...base(cfg),
    path: "/",
    maxAge: MFA_MAX_AGE * 1000,
  });
}

export function clearMfaCookie(res: Response, cfg: CookieConfig): void {
  res.clearCookie(MFA_COOKIE, { ...base(cfg), path: "/" });
}

export function setActiveOrgCookie(
  res: Response,
  orgId: string,
  cfg: CookieConfig,
): void {
  res.cookie(ACTIVE_ORG_COOKIE, sign(orgId, cfg.signingSecret), {
    ...base(cfg),
    path: "/",
    maxAge: cfg.refreshMaxAge * 1000,
  });
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * `value.hmac`. The cookie is HttpOnly so page script cannot read or write it,
 * but the HMAC also catches a value edited through DevTools or a proxy — which
 * for the active-organization cookie would otherwise be a one-line cross-tenant
 * escalation.
 */
export function sign(value: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${mac}`;
}

/** Returns the value, or null if absent/tampered. Never throws. */
export function unsign(
  signed: string | undefined,
  secret: string,
): string | null {
  if (!signed) return null;

  const index = signed.lastIndexOf(".");
  if (index <= 0) return null;

  const value = signed.slice(0, index);
  const mac = signed.slice(index + 1);
  const expected = createHmac("sha256", secret).update(value).digest("hex");

  // Length check first: timingSafeEqual THROWS on a length mismatch rather than
  // returning false, so a truncated cookie would surface as a 500.
  if (mac.length !== expected.length) return null;

  try {
    if (!timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex")))
      return null;
  } catch {
    return null;
  }

  return value;
}
