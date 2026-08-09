import { z } from "zod";

import {
  ApiClientError,
  requestJson,
  type RequestJsonOptions,
} from "./api-client";

const refreshResponseSchema = z.object({ ok: z.literal(true) }).strict();

let refreshInFlight: Promise<void> | null = null;

async function refresh(fetcher: typeof fetch): Promise<void> {
  refreshInFlight ??= requestJson({
    path: "/api/v1/auth/refresh",
    method: "POST",
    schema: refreshResponseSchema,
    fetcher,
  })
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

export async function authenticatedRequestJson<T>(
  options: RequestJsonOptions<T>,
): Promise<T> {
  try {
    return await requestJson(options);
  } catch (error) {
    const method = options.method ?? "GET";
    if (
      method !== "GET" ||
      !(error instanceof ApiClientError) ||
      error.status !== 401
    ) {
      throw error;
    }

    await refresh(options.fetcher ?? fetch);
    return requestJson(options);
  }
}
