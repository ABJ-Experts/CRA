import { type BaseRole } from "@repo/contracts/permissions";
import { z } from "zod";

import { requestJson } from "../../_lib/http/api-client";

const changeRoleResponseSchema = z.object({ ok: z.literal(true) }).strict();

export const membersApi = Object.freeze({
  changeRole(userId: string, role: BaseRole, signal?: AbortSignal) {
    return requestJson({
      path: `/api/v1/users/${userId}/role`,
      method: "PATCH",
      body: { role },
      signal,
      schema: changeRoleResponseSchema,
    });
  },
});
