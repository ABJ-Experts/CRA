import { z } from "zod";

import { requestJson } from "../../_lib/http/api-client";

const updateProfileResponseSchema = z.object({ ok: z.literal(true) }).strict();

export interface UpdateProfileInput {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly jobTitle?: string;
  readonly language?: string;
}

export const accountApi = Object.freeze({
  updateProfile(input: UpdateProfileInput, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/users/me",
      method: "PATCH",
      body: input,
      signal,
      schema: updateProfileResponseSchema,
    });
  },
});
