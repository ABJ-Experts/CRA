import {
  licenseActivationInputSchema,
  licenseActivationResponseSchema,
  licenseCurrentResponseSchema,
  licenseHistoryQuerySchema,
  licenseHistoryResponseSchema,
  licensePolicyResponseSchema,
} from "@repo/contracts/licensing/schemas";
import type {
  LicenseActivationInput,
  LicenseHistoryQuery,
} from "@repo/contracts/licensing/types";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";

export class LicensingGateway {
  constructor(
    private readonly transport: typeof authenticatedRequestJson = authenticatedRequestJson,
  ) {}
  policy(signal?: AbortSignal) {
    return this.transport({
      path: "/api/v1/licensing/policy",
      schema: licensePolicyResponseSchema,
      signal,
    });
  }
  current(signal?: AbortSignal) {
    return this.transport({
      path: "/api/v1/licensing/current",
      schema: licenseCurrentResponseSchema,
      signal,
    });
  }
  history(query: Partial<LicenseHistoryQuery> = {}, signal?: AbortSignal) {
    const parsed = licenseHistoryQuerySchema.parse(query);
    const params = new URLSearchParams({ limit: String(parsed.limit) });
    if (parsed.cursor) params.set("cursor", parsed.cursor);
    return this.transport({
      path: `/api/v1/licensing/history?${params}`,
      schema: licenseHistoryResponseSchema,
      signal,
    });
  }
  activate(input: LicenseActivationInput) {
    return this.transport({
      path: "/api/v1/licensing/activate",
      method: "POST",
      body: licenseActivationInputSchema.parse(input),
      inputSchema: licenseActivationInputSchema,
      schema: licenseActivationResponseSchema,
    });
  }
}
