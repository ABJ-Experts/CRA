import { BASE_ROLES } from "../../permissions.js";
import { z } from "zod";

export const authNextSchema = z.enum([
  "dashboard",
  "two-factor",
  "verify",
  "sign-in",
]);

export const authNextResponseSchema = z
  .object({ next: authNextSchema })
  .strict();

export const sessionUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    username: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    isActive: z.boolean(),
  })
  .strict();

export const sessionOrganizationSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
    role: z.enum(BASE_ROLES),
  })
  .strict();

export const sessionResponseSchema = z
  .object({
    user: sessionUserSchema,
    organization: sessionOrganizationSchema.nullable(),
    organizations: z.array(sessionOrganizationSchema),
  })
  .strict();

export const mfaEnrollmentResponseSchema = z
  .object({
    factorId: z.string().min(1),
    qrCode: z.string().min(1),
    secret: z.string().min(1),
    uri: z.string().min(1),
  })
  .strict();

export const mfaConfirmResponseSchema = z
  .object({ recoveryCodes: z.array(z.string().min(1)) })
  .strict();

export const mfaFactorsResponseSchema = z
  .object({ enrolled: z.boolean() })
  .strict();
