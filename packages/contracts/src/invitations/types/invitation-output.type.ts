import type { z } from "zod";

import type {
  acceptInvitationResponseSchema,
  invitationListResponseSchema,
  invitationSchema,
  invitationStatusSchema,
  organizationSummarySchema,
  resendInvitationResponseSchema,
} from "../schemas/index.js";

export type InvitationStatus = z.output<typeof invitationStatusSchema>;
export type Invitation = z.output<typeof invitationSchema>;
export type OrganizationSummary = z.output<typeof organizationSummarySchema>;
export type InvitationListResponse = z.output<
  typeof invitationListResponseSchema
>;
export type ResendInvitationResponse = z.output<
  typeof resendInvitationResponseSchema
>;
export type AcceptInvitationResponse = z.output<
  typeof acceptInvitationResponseSchema
>;
