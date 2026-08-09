import { z } from "zod";

/** The one place an email is canonicalized across browser, API, and provider. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

const emailSchema = z
  .string()
  .trim()
  .max(254, "That is too long to be an email address")
  .pipe(z.email({ message: "Enter a valid email address" }))
  .transform(normalizeEmail);

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[0-9]/, "Password must contain a number");

const usernameSchema = z
  .string()
  .trim()
  .min(3, "User name must be at least 3 characters")
  .max(32, "User name must be 32 characters or fewer")
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    "Letters, numbers, dot, dash and underscore only",
  );

const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");

export const signUpInputSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export const signInInputSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email or user name")
    .max(254, "That is too long to be an email address"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean().optional().default(false),
});

export const forgotPasswordInputSchema = z.object({ email: emailSchema });

export const resetPasswordInputSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const updatePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  password: passwordSchema,
});

export const verifyEmailInputSchema = z.object({ code: otpCodeSchema });

export const twoFactorInputSchema = z.object({
  code: z.string().trim().min(1, "Enter your code"),
  recovery: z.boolean().optional().default(false),
});

export const unlockInputSchema = z.object({
  password: z.string().min(1, "Enter your password"),
});

export const mfaConfirmInputSchema = z.object({
  factorId: z.string().min(1),
  code: otpCodeSchema,
});

export const mfaFactorParamSchema = z
  .object({ id: z.string().min(1).max(255) })
  .strict();

export const refreshRedirectQuerySchema = z
  .object({ redirectTo: z.string().optional() })
  .transform(({ redirectTo }) => ({
    redirectTo:
      redirectTo?.startsWith("/") && !redirectTo.startsWith("//")
        ? redirectTo
        : "/dashboard",
  }));

// Compatibility names retained for existing screens and services.
export const signUpSchema = signUpInputSchema;
export const signInSchema = signInInputSchema;
export const forgotPasswordSchema = forgotPasswordInputSchema;
export const resetPasswordSchema = resetPasswordInputSchema;
export const updatePasswordSchema = updatePasswordInputSchema;
export const verifyEmailSchema = verifyEmailInputSchema;
export const twoFactorSchema = twoFactorInputSchema;
export const unlockSchema = unlockInputSchema;
