import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  lockedSession,
  requestPasswordReset,
  resendCode,
  resetPassword,
  signIn,
  signUp,
  unlock,
  verifyCode,
  verifyTwoFactor,
  type AuthResult,
} from "./auth-actions";

/**
 * These signatures are a CONTRACT with ten screens that are not being
 * redesigned. The type assertions below fail the build if one drifts.
 *
 * The three zero-identity signatures matter most. `verifyCode`, `unlock` and
 * `resendCode` carry no email and no user id, which is exactly why the API
 * resolves the pending user from a signed cookie and owns email verification
 * rather than delegating to Supabase's OTP flow. "Just pass the email" looks
 * like a simplification and is actually a screen edit plus a backend rewrite.
 */
describe("frozen auth-actions signatures", () => {
  it("signIn takes identifier/password/remember", () => {
    expectTypeOf(signIn).parameter(0).toEqualTypeOf<{
      identifier: string;
      password: string;
      remember: boolean;
    }>();
  });

  it("signUp takes email/username/password", () => {
    expectTypeOf(signUp).parameter(0).toEqualTypeOf<{
      email: string;
      username: string;
      password: string;
    }>();
  });

  it("requestPasswordReset takes only an email", () => {
    expectTypeOf(requestPasswordReset)
      .parameter(0)
      .toEqualTypeOf<{ email: string }>();
  });

  it("resetPassword takes token/password", () => {
    expectTypeOf(resetPassword).parameter(0).toEqualTypeOf<{
      token: string;
      password: string;
    }>();
  });

  it("verifyCode carries NO identity", () => {
    expectTypeOf(verifyCode).parameter(0).toEqualTypeOf<{ code: string }>();
  });

  it("verifyTwoFactor carries NO identity", () => {
    expectTypeOf(verifyTwoFactor).parameter(0).toEqualTypeOf<{
      code: string;
      recovery?: boolean;
    }>();
  });

  it("unlock carries NO identity", () => {
    expectTypeOf(unlock).parameter(0).toEqualTypeOf<{ password: string }>();
  });

  it("resendCode takes NO arguments at all", () => {
    expectTypeOf(resendCode).parameters.toEqualTypeOf<[]>();
  });

  it("every action resolves to AuthResult", () => {
    expectTypeOf(signIn).returns.resolves.toEqualTypeOf<AuthResult>();
    expectTypeOf(resendCode).returns.resolves.toEqualTypeOf<AuthResult>();
  });

  it("AuthResult keeps its original three fields and adds only an optional next", () => {
    // `next` had to be optional: no existing screen reads it, and making it
    // required would have been a breaking change to all ten.
    expectTypeOf<AuthResult>().toEqualTypeOf<{
      ok: boolean;
      message?: string;
      fieldErrors?: Record<string, string>;
      next?: "dashboard" | "two-factor" | "verify" | "sign-in";
    }>();
  });

  it("still exports the lock-screen fallback the screen renders before /session answers", () => {
    expect(lockedSession.email).toBeTruthy();
    expect(lockedSession.name).toBeTruthy();
  });
});

describe("auth action HTTP facade", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a validated success and keeps the sign-in request shape", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ next: "two-factor" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      signIn({
        identifier: "person@example.com",
        password: "correct horse battery staple",
        remember: true,
      }),
    ).resolves.toEqual({ ok: true, next: "two-factor" });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/auth/sign-in", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        password: "correct horse battery staple",
        remember: true,
      }),
    });
  });

  it("maps API field errors into the existing result without mutating them", async () => {
    const serverFieldErrors = Object.freeze({
      email: "Enter a valid email address.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 422,
              message: "Please correct the form.",
              code: "validation_failed",
              fieldErrors: serverFieldErrors,
            }),
            { status: 422 },
          ),
      ),
    );

    await expect(
      requestPasswordReset({ email: "not-an-email" }),
    ).resolves.toEqual({
      ok: false,
      message: "Please correct the form.",
      fieldErrors: { email: "Enter a valid email address." },
    });
  });

  it("returns the safe network message when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private network details");
      }),
    );

    await expect(resendCode()).resolves.toEqual({
      ok: false,
      message: "We could not reach the server.",
    });
  });

  it("fails closed when a successful response has an invalid next value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ next: "admin-console" }), {
            status: 200,
          }),
      ),
    );

    await expect(verifyCode({ code: "123456" })).resolves.toEqual({
      ok: false,
      message: "The server returned an unexpected response.",
    });
  });
});
