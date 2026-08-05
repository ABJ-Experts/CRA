import "server-only";
import { expiryFrom, type Session } from "./session";

/**
 * The GoTrue (Supabase Auth) handshake. Server-side only.
 *
 * Kept separate from the route handler so the wire format lives in one place:
 * GoTrue wants an `apikey` header as well as the bearer, and returns snake_case
 * fields that should not leak into the rest of the app.
 */

const url = () => process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey = () =>
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface GoTrueResult {
  ok: boolean;
  session?: Session;
  /** Safe to show a user. GoTrue's own message, never a stack. */
  message?: string;
}

async function call(path: string, body: unknown): Promise<Response> {
  return fetch(`${url()}/auth/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey(),
      authorization: `Bearer ${anonKey()}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

function toSession(t: TokenResponse): Session {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: expiryFrom(t.expires_in),
  };
}

/**
 * GoTrue reports bad credentials as 400 with `error_description`. Anything else
 * is surfaced as a generic failure — the caller must not be able to tell a
 * wrong password from a non-existent account, which is an enumeration leak.
 */
async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as {
      error_description?: string;
      msg?: string;
      message?: string;
    };
    return j.error_description ?? j.msg ?? j.message ?? "Authentication failed.";
  } catch {
    return "Authentication failed.";
  }
}

export async function passwordGrant(
  email: string,
  password: string,
): Promise<GoTrueResult> {
  const res = await call("/token?grant_type=password", { email, password });
  if (!res.ok) {
    return { ok: false, message: "That email and password do not match." };
  }
  return { ok: true, session: toSession((await res.json()) as TokenResponse) };
}

export async function signUp(
  email: string,
  password: string,
): Promise<GoTrueResult> {
  const res = await call("/signup", { email, password });
  if (!res.ok) return { ok: false, message: await readError(res) };

  const body = (await res.json()) as Partial<TokenResponse>;
  /* With email confirmation on, signup returns a user but NO tokens. That is a
   * success — the caller should route to "check your email", not error. */
  if (!body.access_token) return { ok: true };
  return { ok: true, session: toSession(body as TokenResponse) };
}

export async function refresh(refreshToken: string): Promise<GoTrueResult> {
  const res = await call("/token?grant_type=refresh_token", {
    refresh_token: refreshToken,
  });
  if (!res.ok) return { ok: false, message: "Session expired." };
  return { ok: true, session: toSession((await res.json()) as TokenResponse) };
}

export async function requestPasswordReset(email: string): Promise<GoTrueResult> {
  await call("/recover", { email });
  /* Deliberately always ok: confirming whether an address exists is an account
   * enumeration leak. The UI says "if it exists, we sent a link" either way. */
  return { ok: true };
}

export async function signOut(accessToken: string): Promise<void> {
  await fetch(`${url()}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: anonKey(), authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  }).catch(() => {
    /* Best effort. The cookie is cleared regardless, so the user is signed out
     * locally even if GoTrue is unreachable. */
  });
}
