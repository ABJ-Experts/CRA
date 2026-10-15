import {
  backupCleanupInputSchema,
  backupCleanupReviewInputSchema,
  backupCleanupReviewSchema,
  backupHistoryQuerySchema,
  backupHistorySchema,
  backupInstanceParamsSchema,
  backupMutationSchema,
  backupPolicyInputSchema,
  backupPolicyValidationInputSchema,
  backupPolicySchema,
  backupPolicyResponseSchema,
  backupRunParamsSchema,
  backupRunRequestSchema,
  backupRunSchema,
  backupValidationSchema,
  backupVerificationRequestSchema,
} from "@repo/contracts/backups/schemas";
import type { z } from "zod";
import { OperatorRequestError } from "./operator-gateway";

/** TLS client identity is supplied by the private origin, never a tenant cookie. */
export class BackupsGateway {
  constructor(
    private readonly fetcher: typeof fetch = (input, init) =>
      globalThis.fetch(input, init),
  ) {}

  private base(instanceId: string) {
    const parsed = backupInstanceParamsSchema.parse({ instanceId });
    return `/api/v1/operator/instances/${parsed.instanceId}/backups`;
  }

  private async request<S extends z.ZodType, I extends z.ZodType>(options: {
    path: string;
    schema: S;
    inputSchema?: I;
    body?: z.input<I>;
    method?: "GET" | "POST" | "PUT";
    signal?: AbortSignal;
  }): Promise<z.output<S>> {
    const body = options.inputSchema?.parse(options.body);
    const response = await this.fetcher(options.path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new OperatorRequestError(response.status);
    let result: z.output<S>;
    try {
      result = options.schema.parse(await response.json());
    } catch {
      throw new OperatorRequestError(502);
    }
    this.checkScope(result, options.path);
    return result;
  }

  private checkScope(value: unknown, path: string) {
    const instanceId = path.split("/")[5];
    if (value === null || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const items = Array.isArray(object.items) ? object.items : [object];
    if (
      items.some(
        (item: Record<string, unknown>) =>
          item.instanceId !== undefined && item.instanceId !== instanceId,
      )
    )
      throw new OperatorRequestError(409);
    const match = path.match(
      /\/runs\/([^/?]+)(?:\/(cancel|cleanup|cleanup-review))?$/,
    );
    const responseId = object.id ?? object.runId;
    if (match && responseId !== undefined && responseId !== match[1])
      throw new OperatorRequestError(409);
    const verification = path.match(/\/runs\/([^/?]+)\/verifications$/);
    if (verification && object.parentRunId !== verification[1])
      throw new OperatorRequestError(409);
  }

  async policy(instanceId: string, signal?: AbortSignal) {
    const result = await this.request({
      path: `${this.base(instanceId)}/policy`,
      schema: backupPolicyResponseSchema,
      signal,
    });
    if (result.policy && result.policy.instanceId !== instanceId)
      throw new OperatorRequestError(409);
    return result.policy;
  }
  async validate(
    instanceId: string,
    body: z.input<typeof backupPolicyValidationInputSchema>,
    signal?: AbortSignal,
  ) {
    return this.request({
      path: `${this.base(instanceId)}/policy/validate`,
      method: "POST",
      inputSchema: backupPolicyValidationInputSchema,
      body,
      schema: backupValidationSchema,
      signal,
    });
  }
  async save(
    instanceId: string,
    body: z.input<typeof backupPolicyInputSchema>,
    signal?: AbortSignal,
  ) {
    return this.request({
      path: `${this.base(instanceId)}/policy`,
      method: "PUT",
      inputSchema: backupPolicyInputSchema,
      body,
      schema: backupPolicySchema,
      signal,
    });
  }
  async history(
    instanceId: string,
    input: z.input<typeof backupHistoryQuerySchema> = {},
    signal?: AbortSignal,
  ) {
    const query = backupHistoryQuerySchema.parse(input);
    const params = new URLSearchParams({
      limit: String(query.limit),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    });
    return this.request({
      path: `${this.base(instanceId)}/runs?${params}`,
      schema: backupHistorySchema,
      signal,
    });
  }
  async run(
    instanceId: string,
    body: z.input<typeof backupRunRequestSchema>,
    signal?: AbortSignal,
  ) {
    return this.request({
      path: `${this.base(instanceId)}/runs`,
      method: "POST",
      inputSchema: backupRunRequestSchema,
      body,
      schema: backupRunSchema,
      signal,
    });
  }
  private runPath(instanceId: string, runId: string) {
    const parsed = backupRunParamsSchema.parse({ instanceId, runId });
    return `${this.base(parsed.instanceId)}/runs/${parsed.runId}`;
  }
  async detail(instanceId: string, runId: string, signal?: AbortSignal) {
    return this.request({
      path: this.runPath(instanceId, runId),
      schema: backupRunSchema,
      signal,
    });
  }
  async cancel(
    instanceId: string,
    runId: string,
    body: z.input<typeof backupMutationSchema>,
    signal?: AbortSignal,
  ) {
    return this.request({
      path: `${this.runPath(instanceId, runId)}/cancel`,
      method: "POST",
      inputSchema: backupMutationSchema,
      body,
      schema: backupRunSchema,
      signal,
    });
  }
  async verify(
    instanceId: string,
    runId: string,
    body: z.input<typeof backupVerificationRequestSchema>,
    signal?: AbortSignal,
  ) {
    return this.request({
      path: `${this.runPath(instanceId, runId)}/verifications`,
      method: "POST",
      inputSchema: backupVerificationRequestSchema,
      body,
      schema: backupRunSchema,
      signal,
    });
  }
  async cleanupReview(
    instanceId: string,
    runId: string,
    body: z.input<typeof backupCleanupReviewInputSchema>,
    signal?: AbortSignal,
  ) {
    return this.request({
      path: `${this.runPath(instanceId, runId)}/cleanup-review`,
      method: "POST",
      inputSchema: backupCleanupReviewInputSchema,
      body,
      schema: backupCleanupReviewSchema,
      signal,
    });
  }
  async cleanup(
    instanceId: string,
    runId: string,
    body: z.input<typeof backupCleanupInputSchema>,
    signal?: AbortSignal,
  ) {
    return this.request({
      path: `${this.runPath(instanceId, runId)}/cleanup`,
      method: "POST",
      inputSchema: backupCleanupInputSchema,
      body,
      schema: backupRunSchema,
      signal,
    });
  }
}
export const backupsGateway = new BackupsGateway();
