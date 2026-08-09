import { okResponseSchema } from "@repo/contracts/shared/schemas";
import { updateProfileInputSchema } from "@repo/contracts/users/schemas";
import type { UpdateProfileInput } from "@repo/contracts/users/types";

import { requestJson } from "../../_lib/http/api-client";

export type { UpdateProfileInput } from "@repo/contracts/users/types";

export class AccountApi {
  updateProfile(input: UpdateProfileInput, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/users/me",
      method: "PATCH",
      body: input,
      inputSchema: updateProfileInputSchema,
      signal,
      schema: okResponseSchema,
    });
  }
}

export const accountApi = Object.freeze(new AccountApi());
