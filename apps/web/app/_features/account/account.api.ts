import { okResponseSchema } from "@repo/contracts/shared/schemas";
import { updateProfileInputSchema } from "@repo/contracts/users/schemas";
import type { UpdateProfileInput } from "@repo/contracts/users/types";

import { requestJson } from "../../_lib/http/api-client";
import {
  mutationIdentityHeaders,
  type MutationIdentity,
} from "../../_lib/http/mutation-request-identity";

export type { UpdateProfileInput } from "@repo/contracts/users/types";

export class AccountApi {
  updateProfile(
    input: UpdateProfileInput,
    identity: MutationIdentity,
    signal?: AbortSignal,
  ) {
    return requestJson({
      path: "/api/v1/users/me",
      method: "PATCH",
      body: input,
      inputSchema: updateProfileInputSchema,
      headers: mutationIdentityHeaders(identity),
      signal,
      schema: okResponseSchema,
    });
  }
}

export const accountApi = Object.freeze(new AccountApi());
