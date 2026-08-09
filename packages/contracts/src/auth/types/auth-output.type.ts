import type { z } from "zod";

import type {
  authNextResponseSchema,
  authNextSchema,
  mfaConfirmResponseSchema,
  mfaEnrollmentResponseSchema,
  mfaFactorsResponseSchema,
  sessionOrganizationSchema,
  sessionResponseSchema,
  sessionUserSchema,
} from "../schemas/index.js";

export type AuthNext = z.output<typeof authNextSchema>;
export type AuthNextResponse = z.output<typeof authNextResponseSchema>;
export type SessionUser = z.output<typeof sessionUserSchema>;
export type SessionOrganization = z.output<typeof sessionOrganizationSchema>;
export type SessionResponse = z.output<typeof sessionResponseSchema>;
export type MfaEnrollmentResponse = z.output<
  typeof mfaEnrollmentResponseSchema
>;
export type MfaConfirmResponse = z.output<typeof mfaConfirmResponseSchema>;
export type MfaFactorsResponse = z.output<typeof mfaFactorsResponseSchema>;
