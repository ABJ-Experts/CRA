import { describe, expect, expectTypeOf, it } from "vitest";

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
