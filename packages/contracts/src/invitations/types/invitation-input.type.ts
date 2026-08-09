import type { z } from "zod";

import type {
  acceptInvitationInputSchema,
  createInvitationInputSchema,
  invitationIdParamSchema,
} from "../schemas/index.js";

export type CreateInvitationInput = z.output<
  typeof createInvitationInputSchema
>;
export type AcceptInvitationInput = z.output<
  typeof acceptInvitationInputSchema
>;
export type InvitationIdParam = z.output<typeof invitationIdParamSchema>;
