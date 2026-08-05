import "server-only";
import { cookies } from "next/headers";

/**
 * The session cookie, and the only place its shape is defined.
 *
 * WHY A COOKIE AND NOT localStorage: the browser never talks to GoTrue or to
 * the CRA API directly. Both hops happen in route handlers on the server, which
 * is what lets the access token live in an httpOnly cookie the page's own
 * JavaScript cannot read. That is also why SUPABASE_URL / API_URL are NOT
 * prefixed NEXT_PUBLIC_ — nothing in the browser bundle needs them.
 *
 * The token is a Supabase GoTrue JWT. apps/api verifies it with
 * SUPABASE_JWT_SECRET and reads `sub`, `email` and `aal` from it
 * (apps/api/src/identity/identity-provider.ts), so this is the same credential
 * end to end — the proxy never mints anything of its own.
 */

const COOKIE = "cra_session";

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Active organisation, sent on as X-Organisation-Id. */
  organisationId?: string;
  /** Unix seconds. GoTrue returns a lifetime, we store an absolute instant. */
  expiresAt: number;
}

/**
 * `Secure` is configurable because Playwright drives plain http on 127.0.0.1,
 * where a Secure cookie is dropped and every authenticated test would fail for
 * a reason that looks nothing like the real cause.
 */
const secure = process.env.SESSION_COOKIE_SECURE !== "false";

export async function readSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    /* A malformed cookie is a signed-out user, not a crash. */
    return null;
  }
}

export async function writeSession(session: Session): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify(session), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    /* Track the refresh token's life, not the access token's — the access
     * token is short-lived and refreshed in place. */
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Absolute expiry from GoTrue's relative `expires_in`, minus a 30s skew margin. */
export function expiryFrom(expiresIn: number): number {
  return Math.floor(Date.now() / 1000) + expiresIn - 30;
}
