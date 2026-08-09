import type { z } from "zod";

import type {
  forgotPasswordInputSchema,
  mfaConfirmInputSchema,
  mfaFactorParamSchema,
  refreshRedirectQuerySchema,
  resetPasswordInputSchema,
  signInInputSchema,
  signUpInputSchema,
  twoFactorInputSchema,
  unlockInputSchema,
  updatePasswordInputSchema,
  verifyEmailInputSchema,
} from "../schemas/index.js";

export type SignUpInput = z.output<typeof signUpInputSchema>;
export type SignInInput = z.output<typeof signInInputSchema>;
export type ForgotPasswordInput = z.output<typeof forgotPasswordInputSchema>;
export type ResetPasswordInput = z.output<typeof resetPasswordInputSchema>;
export type UpdatePasswordInput = z.output<typeof updatePasswordInputSchema>;
export type VerifyEmailInput = z.output<typeof verifyEmailInputSchema>;
export type TwoFactorInput = z.output<typeof twoFactorInputSchema>;
export type UnlockInput = z.output<typeof unlockInputSchema>;
export type MfaConfirmInput = z.output<typeof mfaConfirmInputSchema>;
export type MfaFactorParam = z.output<typeof mfaFactorParamSchema>;
export type RefreshRedirectQuery = z.output<typeof refreshRedirectQuerySchema>;
