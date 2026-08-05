/**
 * The single seam between the auth screens and a real backend.
 *
 * Every screen submits through one of these.
 *
 * WIRED to the real GoTrue handshake via /api/auth/*: signIn, signUp,
 * requestPasswordReset, signOut.
 *
 * STILL STUBBED (simulated latency, fixed demo codes): resetPassword,
 * verifyCode, verifyTwoFactor, unlock, resendCode. These need the GoTrue OTP
 * and MFA-challenge endpoints, which is a larger piece of work than the
 * password grant — see MIGRATION-NOTES.md.
 *
 * Each returns `AuthResult` rather than throwing, so screens handle the
 * failure path explicitly instead of relying on a try/catch that is easy to
 * forget. Anything genuinely exceptional still throws.
 */

export interface AuthResult {
  ok: boolean;
  /** Form-level message, shown above the fields. */
  message?: string;
  /** Field-level messages, keyed by the schema's field name. */
  fieldErrors?: Record<string, string>;
}

const LATENCY = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Where the screen should go on success, when the server picks the target. */
export interface AuthOk extends AuthResult {
  next?: string;
}

/**
 * All real calls go to /api/auth/*, never to GoTrue directly. Those route
 * handlers run on the server, which is what lets the session land in an
 * httpOnly cookie the browser cannot read.
 */
async function post(action: string, body?: unknown): Promise<AuthOk> {
  try {
    const res = await fetch(`/api/auth/${action}`, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as AuthOk;
  } catch {
    /* Network-level failure only — the handler returns 200 with ok:false for
     * ordinary credential failures, so this really is "could not reach it". */
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

export async function signIn(input: {
  identifier: string;
  password: string;
  remember: boolean;
}): Promise<AuthOk> {
  return post("sign-in", { email: input.identifier, password: input.password });
}

export async function signUp(input: {
  email: string;
  username: string;
  password: string;
}): Promise<AuthOk> {
  const result = await post("sign-up", {
    email: input.email,
    password: input.password,
  });
  /* GoTrue reports a duplicate address as a form-level message; the screen
   * shows it against the email field, which is where the user can act on it. */
  if (!result.ok && result.message && /registered|already/i.test(result.message)) {
    return { ok: false, fieldErrors: { email: result.message } };
  }
  return result;
}

export async function requestPasswordReset(input: { email: string }): Promise<AuthResult> {
  // Always ok, by design on both sides: telling a caller whether an address
  // exists is an account-enumeration leak, so the UI says "if it exists, we
  // sent a link" either way.
  return post("reset", { email: input.email });
}

/** Ends the GoTrue session and clears the cookie. */
export async function signOut(): Promise<AuthOk> {
  return post("sign-out");
}

export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<AuthResult> {
  await wait(LATENCY);
  if (input.token === "expired") {
    return { ok: false, message: "That reset link has expired." };
  }
  return { ok: true };
}

export async function verifyCode(input: { code: string }): Promise<AuthResult> {
  await wait(LATENCY);
  if (input.code !== "123456") {
    return { ok: false, message: "That code is not right. Check it and try again." };
  }
  return { ok: true };
}

export async function verifyTwoFactor(input: {
  code: string;
  recovery?: boolean;
}): Promise<AuthResult> {
  await wait(LATENCY);
  if (input.recovery) {
    return input.code.length >= 8
      ? { ok: true }
      : { ok: false, message: "That recovery code is not valid." };
  }
  return input.code === "123456"
    ? { ok: true }
    : { ok: false, message: "That code is not right. Check your authenticator app." };
}

export async function unlock(input: { password: string }): Promise<AuthResult> {
  await wait(LATENCY);
  return input.password === "wrong" ? { ok: false, message: "Wrong password." } : { ok: true };
}

export async function resendCode(): Promise<AuthResult> {
  await wait(LATENCY);
  return { ok: true };
}

/** Stand-in for the signed-in user the Lock Screen shows. */
export const lockedSession = {
  name: "Leslie Alexander",
  email: "lesliealexander@cra.com",
} as const;
