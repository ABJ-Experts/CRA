import type { BaseRole } from "@repo/contracts/permissions";
import { okResponseSchema } from "@repo/contracts/shared/schemas";
import {
  changeMemberRoleInputSchema,
  memberIdParamSchema,
} from "@repo/contracts/users/schemas";

import { apiClient, requestJson } from "../../_lib/http/api-client";

export class MembersApi {
  async changeRole(userId: string, role: BaseRole, signal?: AbortSignal) {
    const { id } = apiClient.parseInput(memberIdParamSchema, { id: userId });
    return requestJson({
      path: `/api/v1/users/${id}/role`,
      method: "PATCH",
      body: { role },
      inputSchema: changeMemberRoleInputSchema,
      signal,
      schema: okResponseSchema,
    });
  }
}

export const membersApi = Object.freeze(new MembersApi());
