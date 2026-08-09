import { BASE_ROLES } from "../../permissions.js";
import { z } from "zod";

export const createInvitationInputSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email({ message: "Enter a valid email address" }))
    .transform((email) => email.toLowerCase()),
  role: z.enum(BASE_ROLES).default("member"),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
});

export const acceptInvitationInputSchema = z.object({
  token: z.string().min(32).max(128),
});

export const invitationIdParamSchema = z.object({ id: z.uuid() }).strict();
