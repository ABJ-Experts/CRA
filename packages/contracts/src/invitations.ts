import { z } from "zod";

import { BASE_ROLES } from "./permissions.js";

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
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const organizationSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
  })
  .strict();

export const acceptInvitationResponseSchema = z
  .object({
    ok: z.literal(true),
    alreadyAccepted: z.boolean(),
    organization: organizationSummarySchema,
  })
  .strict();

export type InvitationStatus = z.infer<typeof invitationStatusSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type AcceptInvitationResponse = z.infer<
  typeof acceptInvitationResponseSchema
>;
