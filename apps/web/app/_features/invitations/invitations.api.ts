import {
  acceptInvitationInputSchema,
  acceptInvitationResponseSchema,
} from "@repo/contracts/invitations/schemas";

import { requestJson } from "../../_lib/http/api-client";

export class InvitationsApi {
  accept(token: string, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/invitations/accept",
      method: "POST",
      body: { token },
      inputSchema: acceptInvitationInputSchema,
      signal,
      schema: acceptInvitationResponseSchema,
    });
  }
}

export const invitationsApi = Object.freeze(new InvitationsApi());
