/**
 * The single seam between the auth screens and the backend.
 *
 * Every screen submits through one of these. The bodies now `fetch` the real
 * API; the SIGNATURES ARE FROZEN and must stay that way, because ten screens
 * call them and none of those screens is being redesigned.
 *
 * THE CONSTRAINT THAT SHAPES THE WHOLE BACKEND:
 *   three of these carry no identity at all — `verifyCode({code})`,
 *   `unlock({password})`, and `resendCode()` which takes no arguments
 *   whatsoever. There is nowhere to put an email. That is why the API resolves
 *   the pending user from a signed, HttpOnly `cra_pending` cookie, and why
 *   email verification is ours rather than a call to Supabase's own OTP flow
 *   (which requires the address).
 *
 *   Do not "simplify" this by passing an email from the client. That would mean
 *   editing a frozen screen, and the type test in `auth-actions.spec.ts` will
 *   fail if a signature changes.
 *
 * Each returns `AuthResult` rather than throwing, so screens handle the failure
 * path explicitly instead of relying on a try/catch that is easy to forget.
 */

import {
  authNextResponseSchema,
  forgotPasswordInputSchema,
  resetPasswordInputSchema,
  signInInputSchema,
  signUpInputSchema,
  twoFactorInputSchema,
  unlockInputSchema,
  verifyEmailInputSchema,
} from "@repo/contracts/auth/schemas";
import { okResponseSchema } from "@repo/contracts/shared/schemas";
import type { z } from "zod";

import { ApiClientError, requestJson } from "../../_lib/http/api-client";

export interface AuthResult {
  ok: boolean;
  /** Form-level message, shown above the fields. */
  message?: string;
  /** Field-level messages, keyed by the schema's field name. */
  fieldErrors?: Record<string, string>;
  /**
   * Where the server wants the user to go next. Optional and additive: no
   * existing screen reads it, so adding it broke nothing.
   */
  next?: "dashboard" | "two-factor" | "verify" | "sign-in";
}

/**
 * Relative, so the browser calls its own origin and `next.config.js` proxies to
 * the API. First-party cookies, no CORS on this path.
 */
const API = "/api/v1";

interface AuthRequest<TSchema extends z.ZodTypeAny> {
  readonly schema: TSchema;
  readonly body: z.input<TSchema>;
}

/** Stateful auth gateway behind the eight frozen functional action exports. */
class AuthActionsApi {
  async post<
    TResponseSchema extends z.ZodTypeAny,
    TInputSchema extends z.ZodTypeAny,
  >(
    path: `/${string}`,
    responseSchema: TResponseSchema,
    request?: AuthRequest<TInputSchema>,
  ): Promise<AuthResult> {
    try {
      const requestPath = `${API}${path}` as const;
      const data = request
        ? await requestJson({
            path: requestPath,
            method: "POST",
            body: request.body,
            inputSchema: request.schema,
            schema: responseSchema,
          })
        : await requestJson({
            path: requestPath,
            method: "POST",
            schema: responseSchema,
          });
      const nextResponse = authNextResponseSchema.safeParse(data);
      return {
        ok: true,
        next: nextResponse.success ? nextResponse.data.next : undefined,
      };
    } catch (error) {
      return error instanceof ApiClientError
        ? {
            ok: false,
            message: error.message,
            ...(error.fieldErrors
              ? { fieldErrors: { ...error.fieldErrors } }
              : {}),
          }
        : { ok: false, message: "Something went wrong. Please try again." };
    }
  }
}

const authActionsApi = Object.freeze(new AuthActionsApi());

export async function signIn(input: {
  identifier: string;
  password: string;
  remember: boolean;
}): Promise<AuthResult> {
  // The screen calls the field `identifier` because it accepts an email OR a
  // user name; the API resolves either.
  return authActionsApi.post("/auth/sign-in", authNextResponseSchema, {
    schema: signInInputSchema,
    body: {
      email: input.identifier,
      password: input.password,
      remember: input.remember,
    },
  });
}

export async function signUp(input: {
  email: string;
  username: string;
  password: string;
}): Promise<AuthResult> {
  return authActionsApi.post("/auth/sign-up", authNextResponseSchema, {
    schema: signUpInputSchema,
    body: input,
  });
}

export async function requestPasswordReset(input: {
  email: string;
}): Promise<AuthResult> {
  /*
   * Still always ok, exactly as the stub was. Telling a caller whether an
   * address exists is an account-enumeration leak, so the UI says "if it exists,
   * we sent a link" either way. The API enforces the same property server-side,
   * including a minimum response time so the TIMING does not leak it either.
   */
  return authActionsApi.post("/auth/forgot-password", okResponseSchema, {
    schema: forgotPasswordInputSchema,
    body: input,
  });
}

export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<AuthResult> {
  return authActionsApi.post("/auth/reset-password", authNextResponseSchema, {
    schema: resetPasswordInputSchema,
    body: input,
  });
}

/**
 * No email argument — see the note at the top of this file. The pending user
 * comes from the `cra_pending` cookie set at sign-up.
 */
export async function verifyCode(input: { code: string }): Promise<AuthResult> {
  return authActionsApi.post("/auth/verify-email", authNextResponseSchema, {
    schema: verifyEmailInputSchema,
    body: input,
  });
}

export async function verifyTwoFactor(input: {
  code: string;
  recovery?: boolean;
}): Promise<AuthResult> {
  return authActionsApi.post(
    "/auth/two-factor/verify",
    authNextResponseSchema,
    { schema: twoFactorInputSchema, body: input },
  );
}

/** Lock Screen re-authentication. Identity comes from the live session. */
export async function unlock(input: { password: string }): Promise<AuthResult> {
  return authActionsApi.post("/auth/unlock", authNextResponseSchema, {
    schema: unlockInputSchema,
    body: input,
  });
}

/** No arguments at all. Resolved from the pending cookie. */
export async function resendCode(): Promise<AuthResult> {
  return authActionsApi.post("/auth/resend-code", okResponseSchema);
}

/**
 * The signed-in user the Lock Screen shows.
 *
 * Kept as a constant so the screen renders something sensible before the
 * session request resolves, and if it fails. `lock/page.tsx` overlays the real
 * user once `GET /auth/session` answers.
 */
export const lockedSession = {
  name: "Leslie Alexander",
  email: "lesliealexander@cra.com",
} as const;
