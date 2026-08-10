import {
  acceptInvitationInputSchema,
  acceptInvitationResponseSchema,
  createInvitationInputSchema,
  invitationIdParamSchema,
  invitationListResponseSchema,
  resendInvitationInputSchema,
  resendInvitationResponseSchema,
} from "@repo/contracts/invitations/schemas";
import type { CreateInvitationInput } from "@repo/contracts/invitations/types";
import {
  idResponseSchema,
  okResponseSchema,
} from "@repo/contracts/shared/schemas";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
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

  list(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/invitations",
      method: "GET",
      signal,
      schema: invitationListResponseSchema,
    });
  }

  create(input: CreateInvitationInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/invitations",
      method: "POST",
      body: input,
      inputSchema: createInvitationInputSchema,
      signal,
      schema: idResponseSchema,
    });
  }

  resend(invitationId: string, signal?: AbortSignal) {
    const { id } = invitationIdParamSchema.parse({ id: invitationId });
    return authenticatedRequestJson({
      path: `/api/v1/invitations/${id}/resend`,
      method: "POST",
      body: {},
      inputSchema: resendInvitationInputSchema,
      signal,
      schema: resendInvitationResponseSchema,
    });
  }

  revoke(invitationId: string, signal?: AbortSignal) {
    const { id } = invitationIdParamSchema.parse({ id: invitationId });
    return authenticatedRequestJson({
      path: `/api/v1/invitations/${id}`,
      method: "DELETE",
      signal,
      schema: okResponseSchema,
    });
  }
}

export const invitationsApi = Object.freeze(new InvitationsApi());
