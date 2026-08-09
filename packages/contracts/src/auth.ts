/**
 * Wire schemas for the auth endpoints.
 *
 * These deliberately mirror the Zod schemas already embedded in the frozen
 * screens under `apps/web/app/(auth)/`, field for field and message for
 * message. The server must never be laxer than the client: if it were, the
 * admin/invite path could mint an account whose password the sign-in screen's
 * own schema would reject.
 *
 * Verified against:
 *   sign-up/page.tsx        username 3-32 /^[a-zA-Z0-9_.-]+$/, password >=8 + digit
 *   sign-in/page.tsx        identifier 1-254 (email OR username), password >=1
 *   forgot-password/page.tsx  email
 *   reset-password/page.tsx   password >=8 + digit
 *   lock/page.tsx             password >=1
 *
 * NOTE: `apps/infrastructure/supabase/config.toml` must carry
 * `minimum_password_length = 8` and `password_requirements = "letters_digits"`
 * to match. It shipped as 6 / "" — see the migration plan.
 */

import { z } from "zod";

export type { ApiErrorBody } from "./http.js";

/** The one place an email is canonicalized. GoTrue lowercases too, so the tiers agree. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

const email = z
  .string()
  .trim()
  .max(254, "That is too long to be an email address")
  .pipe(z.email({ message: "Enter a valid email address" }))
  .transform(normalizeEmail);

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[0-9]/, "Password must contain a number");

const username = z
  .string()
  .trim()
  .min(3, "User name must be at least 3 characters")
  .max(32, "User name must be 32 characters or fewer")
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    "Letters, numbers, dot, dash and underscore only",
  );

/** A 6-digit numeric OTP, matching `@repo/ui/otp-input`'s default length. */
const otpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");

export const signUpSchema = z.object({
  email,
  username,
  password,
});

export const signInSchema = z.object({
  /** Email OR username — the screen labels it "email or user name". */
  email: z.string().trim().min(1, "Enter your email or user name").max(254),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password,
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  password,
});

/**
 * No email field. `verifyCode({ code })` in the frozen `auth-actions.ts` carries
 * no identity, so the pending user is resolved from the signed `cra_pending`
 * cookie instead. This is the constraint that made `auth_email_verifications` a
 * table rather than a call to GoTrue.
 */
export const verifyEmailSchema = z.object({ code: otpCode });

export const twoFactorSchema = z.object({
  code: z.string().trim().min(1, "Enter your code"),
  recovery: z.boolean().optional().default(false),
});

/** `unlock({ password })` — identity comes from the live session. */
export const unlockSchema = z.object({
  password: z.string().min(1, "Enter your password"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type TwoFactorInput = z.infer<typeof twoFactorSchema>;
export type UnlockInput = z.infer<typeof unlockSchema>;

// ---------------------------------------------------------------------------
// Response contracts
// ---------------------------------------------------------------------------

/** Where the server wants the client to go after a successful auth step. */
export type AuthNext = "dashboard" | "two-factor" | "verify" | "sign-in";

export interface SessionUser {
  id: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface SessionResponse {
  user: SessionUser;
  organization: SessionOrganization | null;
  organizations: SessionOrganization[];
}
