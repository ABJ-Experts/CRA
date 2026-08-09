import { okResponseSchema } from "@repo/contracts/shared/schemas";
import type { z } from "zod";

import {
  ApiClientError,
  apiClient,
  type ApiClient,
  type RequestJsonOptions,
} from "./api-client";

/**
 * Stateful decorator around ApiClient that owns refresh single-flight state.
 * Keeping this lifecycle inside an instance avoids loose mutable module state.
 */
export class AuthenticatedApiClient {
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly client: Pick<ApiClient, "request"> = apiClient,
  ) {}

  async request<
    TResponseSchema extends z.ZodTypeAny,
    TInputSchema extends z.ZodTypeAny = z.ZodNever,
  >(
    options: RequestJsonOptions<TResponseSchema, TInputSchema>,
  ): Promise<z.output<TResponseSchema>> {
    try {
      return await this.client.request(options);
    } catch (error) {
      const method = options.method ?? "GET";
      if (
        method !== "GET" ||
        !(error instanceof ApiClientError) ||
        error.status !== 401
      ) {
        throw error;
      }

      await this.refresh(options.fetcher ?? fetch);
      return this.client.request(options);
    }
  }

  private async refresh(fetcher: typeof fetch): Promise<void> {
    this.refreshInFlight ??= this.client
      .request({
        path: "/api/v1/auth/refresh",
        method: "POST",
        schema: okResponseSchema,
        fetcher,
      })
      .then(() => undefined)
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }
}

export const authenticatedApiClient = new AuthenticatedApiClient();

/** Compatibility facade retained for hooks and feature gateways. */
export function authenticatedRequestJson<
  TResponseSchema extends z.ZodTypeAny,
  TInputSchema extends z.ZodTypeAny = z.ZodNever,
>(
  options: RequestJsonOptions<TResponseSchema, TInputSchema>,
): Promise<z.output<TResponseSchema>> {
  return authenticatedApiClient.request(options);
}
