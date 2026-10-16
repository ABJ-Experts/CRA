import {
  operatorEmptyQuerySchema,
  operatorInstanceParamsSchema,
  operatorInstancesQuerySchema,
  operatorInstancesResponseSchema,
  operatorInstanceResponseSchema,
  operatorSessionResponseSchema,
  operatorTenantsQuerySchema,
  operatorTenantsResponseSchema,
} from "@repo/contracts";
import type { z } from "zod";

export class OperatorRequestError extends Error {
  constructor(readonly status: number) {
    super("The private metadata request could not be completed.");
    this.name = "OperatorRequestError";
  }
}
/** mTLS is supplied by the browser TLS connection, never by tenant tokens. */
export class OperatorGateway {
  constructor(
    private readonly fetcher: typeof fetch = (input, init) =>
      globalThis.fetch(input, init),
  ) {}
  private async read<S extends z.ZodType>(
    path: string,
    schema: S,
    signal?: AbortSignal,
  ): Promise<z.output<S>> {
    const response = await this.fetcher(path, {
      method: "GET",
      // Fetch credentials include TLS client certificates. Restrict them to
      // this private origin; the listener never treats cookies as authority.
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new OperatorRequestError(response.status);
    try {
      return schema.parse(await response.json());
    } catch {
      throw new OperatorRequestError(502);
    }
  }
  async session(signal?: AbortSignal) {
    operatorEmptyQuerySchema.parse({});
    return this.read(
      "/api/v1/operator/session",
      operatorSessionResponseSchema,
      signal,
    );
  }
  async instances(
    input: z.input<typeof operatorInstancesQuerySchema> = {},
    signal?: AbortSignal,
  ) {
    const query = operatorInstancesQuerySchema.parse(input);
    const params = new URLSearchParams({
      limit: String(query.limit),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return this.read(
      `/api/v1/operator/instances?${params}`,
      operatorInstancesResponseSchema,
      signal,
    );
  }
  async instance(instanceId: string, signal?: AbortSignal) {
    const params = operatorInstanceParamsSchema.parse({ instanceId });
    const response = await this.read(
      `/api/v1/operator/instances/${params.instanceId}`,
      operatorInstanceResponseSchema,
      signal,
    );
    if (response.instance.instanceId !== params.instanceId)
      throw new OperatorRequestError(409);
    return response;
  }
  async tenants(
    instanceId: string,
    input: z.input<typeof operatorTenantsQuerySchema> = {},
    signal?: AbortSignal,
  ) {
    const parsed = operatorInstanceParamsSchema.parse({ instanceId });
    const query = operatorTenantsQuerySchema.parse(input);
    const params = new URLSearchParams({
      limit: String(query.limit),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const response = await this.read(
      `/api/v1/operator/instances/${parsed.instanceId}/tenants?${params}`,
      operatorTenantsResponseSchema,
      signal,
    );
    if (response.instanceId !== parsed.instanceId)
      throw new OperatorRequestError(409);
    return response;
  }
}
export const operatorGateway = new OperatorGateway();
