import * as schemas from "@repo/contracts/upgrades/schemas";
import type { z } from "zod";
import { OperatorRequestError } from "./operator-gateway";
export class UpgradesGateway {
  constructor(
    private readonly fetcher: typeof fetch = (input, init) =>
      globalThis.fetch(input, init),
  ) {}
  private async request<S extends z.ZodType>(
    instanceId: string,
    path: string,
    schema: S,
    body?: unknown,
    signal?: AbortSignal,
    runId?: string,
  ): Promise<z.output<S>> {
    schemas.upgradeInstanceParamsSchema.parse({ instanceId });
    const response = await this.fetcher(
      `/api/v1/operator/instances/${instanceId}/upgrades/${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (!response.ok) throw new OperatorRequestError(response.status);
    let result: z.output<S>;
    try {
      result = schema.parse(await response.json());
    } catch {
      throw new OperatorRequestError(502);
    }
    const check = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (object.instanceId !== undefined && object.instanceId !== instanceId)
        throw new OperatorRequestError(409);
      if (
        runId &&
        (object.runId ?? object.id) !== undefined &&
        (object.runId ?? object.id) !== runId
      )
        throw new OperatorRequestError(409);
      if (Array.isArray(object.items)) object.items.forEach(check);
      for (const nested of [object.preflight, object.result]) {
        if (
          nested &&
          typeof nested === "object" &&
          (nested as Record<string, unknown>).runId !==
            (object.id ?? object.runId)
        )
          throw new OperatorRequestError(409);
      }
    };
    check(result);
    return result;
  }
  async capabilities(instanceId: string, signal?: AbortSignal) {
    return this.request(
      instanceId,
      "capabilities",
      schemas.upgradeCapabilitiesSchema,
      undefined,
      signal,
    );
  }
  async media(instanceId: string, signal?: AbortSignal) {
    return this.request(
      instanceId,
      "media",
      schemas.upgradeMediaListSchema,
      undefined,
      signal,
    );
  }
  async history(
    instanceId: string,
    signal?: AbortSignal,
    input: z.input<typeof schemas.upgradeHistoryQuerySchema> = {},
  ) {
    const query = schemas.upgradeHistoryQuerySchema.parse(input);
    const parameters = new URLSearchParams({
      limit: String(query.limit),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return this.request(
      instanceId,
      `history?${parameters}`,
      schemas.upgradeHistorySchema,
      undefined,
      signal,
    );
  }
  async stage(
    instanceId: string,
    input: z.input<typeof schemas.upgradeStageInputSchema>,
    signal?: AbortSignal,
  ) {
    return this.request(
      instanceId,
      "stage",
      schemas.upgradeRunSchema,
      schemas.upgradeStageInputSchema.parse(input),
      signal,
    );
  }
  async preflight(
    instanceId: string,
    runId: string,
    input: z.input<typeof schemas.upgradePreflightInputSchema>,
    signal?: AbortSignal,
  ) {
    schemas.upgradeRunParamsSchema.parse({ instanceId, runId });
    return this.request(
      instanceId,
      `runs/${runId}/preflight`,
      schemas.upgradePreflightSchema,
      schemas.upgradePreflightInputSchema.parse(input),
      signal,
      runId,
    );
  }
  async apply(
    instanceId: string,
    runId: string,
    input: z.input<typeof schemas.upgradeApplyInputSchema>,
    signal?: AbortSignal,
  ) {
    schemas.upgradeRunParamsSchema.parse({ instanceId, runId });
    return this.request(
      instanceId,
      `runs/${runId}/apply`,
      schemas.upgradeRunSchema,
      schemas.upgradeApplyInputSchema.parse(input),
      signal,
      runId,
    );
  }
  async rollback(
    instanceId: string,
    runId: string,
    input: z.input<typeof schemas.upgradeRollbackInputSchema>,
    signal?: AbortSignal,
  ) {
    schemas.upgradeRunParamsSchema.parse({ instanceId, runId });
    return this.request(
      instanceId,
      `runs/${runId}/rollback`,
      schemas.upgradeRunSchema,
      schemas.upgradeRollbackInputSchema.parse(input),
      signal,
      runId,
    );
  }
  async reconcile(
    instanceId: string,
    runId: string,
    input: z.input<typeof schemas.upgradeMutationSchema>,
    signal?: AbortSignal,
  ) {
    schemas.upgradeRunParamsSchema.parse({ instanceId, runId });
    return this.request(
      instanceId,
      `runs/${runId}/reconcile`,
      schemas.upgradeRunSchema,
      schemas.upgradeMutationSchema.parse(input),
      signal,
      runId,
    );
  }
  async detail(instanceId: string, runId: string, signal?: AbortSignal) {
    schemas.upgradeRunParamsSchema.parse({ instanceId, runId });
    return this.request(
      instanceId,
      `runs/${runId}`,
      schemas.upgradeRunSchema,
      undefined,
      signal,
      runId,
    );
  }
  async result(instanceId: string, runId: string, signal?: AbortSignal) {
    schemas.upgradeRunParamsSchema.parse({ instanceId, runId });
    return this.request(
      instanceId,
      `runs/${runId}/result`,
      schemas.upgradeResultSchema,
      undefined,
      signal,
      runId,
    );
  }
}
export const upgradesGateway = new UpgradesGateway();
