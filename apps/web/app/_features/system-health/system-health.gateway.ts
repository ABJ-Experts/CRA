import {
  customerSystemHealthV2QuerySchema,
  customerSystemHealthV2ResponseSchema,
} from "@repo/contracts/system/schemas";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

/** The cache scope is presentation identity; the server derives its own tenant. */
export class SystemHealthGateway {
  constructor(private readonly request = authenticatedRequestJson) {}

  async read(organizationId: string, signal?: AbortSignal) {
    customerSystemHealthV2QuerySchema.parse({ schemaVersion: 2 });
    const response = await this.request({
      path: "/api/v1/system/health?schemaVersion=2",
      method: "GET",
      signal,
      schema: customerSystemHealthV2ResponseSchema,
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
