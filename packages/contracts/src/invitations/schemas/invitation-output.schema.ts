import { BASE_ROLES } from "../../permissions.js";
import { z } from "zod";

export const invitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "declined",
  "expired",
]);

export const invitationSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(BASE_ROLES),
    status: invitationStatusSchema,
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const organizationSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
  })
  .strict();

export const invitationListResponseSchema = z
  .object({ rows: z.array(invitationSchema) })
  .strict();

/** Only successful SMTP delivery can produce a successful resend response. */
export const resendInvitationResponseSchema = z
  .object({
    id: z.uuid(),
    delivery: z.literal("confirmed"),
  })
  .strict();

export const acceptInvitationResponseSchema = z
  .object({
    ok: z.literal(true),
    alreadyAccepted: z.boolean(),
    organization: organizationSummarySchema,
  })
  .strict();
