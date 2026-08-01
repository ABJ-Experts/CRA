/**
 * The single seam between the auth screens and a real backend.
 *
 * Every screen submits through one of these. They currently simulate latency
 * and can fail, so loading and error paths are exercised for real; swapping in
 * `fetch` calls to `apps/api` means editing this file and nothing else.
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

/**
 * Demo rule so the error path is reachable without a backend: any address at
 * `@taken.com` is treated as already registered, and the password `wrong`
 * fails sign in. Delete these with the stubs.
 */
export async function signIn(input: {
  identifier: string;
  password: string;
  remember: boolean;
}): Promise<AuthResult> {
  await wait(LATENCY);
  if (input.password === "wrong") {
    return { ok: false, message: "That email and password do not match." };
  }
  return { ok: true };
}

export async function signUp(input: {
  email: string;
  username: string;
  password: string;
}): Promise<AuthResult> {
  await wait(LATENCY);
  if (input.email.endsWith("@taken.com")) {
    return {
      ok: false,
      fieldErrors: { email: "That email is already registered." },
    };
  }
  return { ok: true };
}

export async function requestPasswordReset(input: {
  email: string;
}): Promise<AuthResult> {
  await wait(LATENCY);
  // Deliberately always ok: telling a caller whether an address exists is an
  // account-enumeration leak, so the UI says "if it exists, we sent a link"
  // either way.
  void input;
  return { ok: true };
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

export async function verifyCode(input: {
  code: string;
}): Promise<AuthResult> {
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
  return input.password === "wrong"
    ? { ok: false, message: "Wrong password." }
    : { ok: true };
}

export async function resendCode(): Promise<AuthResult> {
  await wait(LATENCY);
  return { ok: true };
}

/** Stand-in for the signed-in user the Lock Screen shows. */
export const lockedSession = {
  name: "Leslie Alexander",
  email: "lesliealexander@supehub.com",
} as const;
