import {
  customerSystemHealthQuerySchema,
  customerSystemHealthResponseSchema,
} from "@repo/contracts";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

/** The cache scope is presentation identity; the server derives its own tenant. */
export class SystemHealthGateway {
  constructor(private readonly request = authenticatedRequestJson) {}

  async read(organizationId: string, signal?: AbortSignal) {
    customerSystemHealthQuerySchema.parse({});
    const response = await this.request({
      path: "/api/v1/system/health",
      method: "GET",
      signal,
      schema: customerSystemHealthResponseSchema,
    });
    if (response.organizationId !== organizationId) {
      throw new ApiClientError(
        "invalid_response",
        "Organization changed. Reload system health.",
        409,
      );
    }
    return response;
  }
}
export const systemHealthGateway = new SystemHealthGateway();
