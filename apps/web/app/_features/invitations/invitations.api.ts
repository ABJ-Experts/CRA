import { acceptInvitationResponseSchema } from "@repo/contracts/invitations";

import { requestJson } from "../../_lib/http/api-client";

export const invitationsApi = Object.freeze({
  accept(token: string, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/invitations/accept",
      method: "POST",
      body: { token },
      signal,
      schema: acceptInvitationResponseSchema,
    });
  },
});
