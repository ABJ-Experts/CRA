import type { WebhookPageQuery as PageParams } from "@repo/contracts/connectors/types";
import {
  webhookAttemptSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
  webhookReplayPreviewSchema,
  webhookResourceReferenceSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  WebhookDelivery,
  WebhookEndpoint,
} from "@repo/contracts/connectors/types";
import type { Paged } from "@repo/contracts/pagination";
import { pagedSchema } from "@repo/contracts/pagination/schemas";
import { z } from "zod";
import type { ConnectorAuthorization } from "../application/connector-authorization.port";
import type { SupabaseService } from "../../supabase/supabase.service";
import { ConnectorError } from "../application/connector-errors";
import type {
  ClaimedWebhookDelivery,
  WebhookDeliveryContext,
  WebhookEndpointCommandRequest,
  WebhookSourceScope,
  WebhookRepositoryPort,
} from "../application/webhook-repository.port";

interface Result {
  data: unknown;
  error: unknown;
  count?: number | null;
}
interface Query extends PromiseLike<Result> {
  select(columns: string, options?: { count?: "exact" }): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, value: readonly unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
  maybeSingle(): Promise<Result>;
}
interface Client {
  from(table: string): Query;
  rpc(name: string, args: Readonly<Record<string, unknown>>): Promise<Result>;
}

const commandRowSchema = z.object({ request_digest_key_id: z.string() });
const signingSecretSchema = z.object({
  keyId: z.string().uuid(),
  secretId: z.string().uuid(),
  revision: z.number().int().positive(),
  envelope: z.object({
    format: z.literal("aes-256-gcm-v1"),
    keyId: z.string(),
    ciphertext: z.string(),
    nonce: z.string(),
    authTag: z.string(),
  }),
});
const contextSchema = z.object({
  delivery: webhookDeliverySchema,
  productIds: z.array(z.string().uuid()).max(100),
  sourceKind: z.string(),
  sourceId: z.string().uuid(),
  destinationRevision: z.number().int(),
  scopeRevision: z.number().int(),
  destinationUrl: z.string().url(),
});
const claimSchema = contextSchema.extend({
  endpoint: z.object({
    id: z.string().uuid(),
    url: z.string().url(),
    secretRevision: z.number().int().positive(),
    active: signingSecretSchema,
    previous: signingSecretSchema.extend({ expiresAt: z.string() }).nullable(),
  }),
  authorizationActorId: z.string().uuid(),
  endpointAuthorizationActorId: z.string().uuid(),
  permissionVersion: z.number().int().nonnegative(),
  payloadBytes: z.string().nullable(),
  leaseGeneration: z.number().int().positive(),
  workerId: z.string(),
});

/** Service-role boundary: every read carries organization_id as the first scope. */
export class SupabaseWebhookRepository implements WebhookRepositoryPort {
  constructor(private readonly supabase: SupabaseService) {}
  private client(): Client {
    return this.supabase.admin() as unknown as Client;
  }

  async listEndpoints(
    orgId: string,
    params: PageParams,
  ): Promise<Paged<WebhookEndpoint>> {
    const page = pageInput(params);
    const result = await this.client()
      .from("webhook_endpoints")
      .select("*", { count: "exact" })
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page.from, page.to);
    if (result.error || !Array.isArray(result.data))
      throw new ConnectorError("unavailable");
    return pageRows(
      webhookEndpointSchema,
      result.data.map(endpointJson),
      result.count ?? 0,
      params,
    );
  }

  async endpoint(orgId: string, endpointId: string): Promise<WebhookEndpoint> {
    const result = await this.client()
      .from("webhook_endpoints")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", endpointId)
      .maybeSingle();
    if (result.error) throw new ConnectorError("unavailable");
    if (!result.data) throw new ConnectorError("not_found");
    return webhookEndpointSchema.parse(endpointJson(result.data));
  }

  async signingSecrets(orgId: string, endpointId: string) {
    const result = await this.client()
      .from("webhook_endpoints")
      .select(
        "signing_key_id,secret_id,secret_revision,secret_ciphertext,secret_key_id,secret_nonce,secret_auth_tag,previous_signing_key_id,previous_secret_id,previous_secret_revision,previous_secret_ciphertext,previous_secret_key_id,previous_secret_nonce,previous_secret_auth_tag,previous_secret_expires_at",
      )
      .eq("organization_id", orgId)
      .eq("id", endpointId)
      .maybeSingle();
    if (result.error) throw new ConnectorError("unavailable");
    if (!result.data) throw new ConnectorError("not_found");
    const row = result.data as Record<string, unknown>;
    const slots = [
      "",
      ...(typeof row.previous_secret_expires_at === "string" &&
      Date.parse(row.previous_secret_expires_at) > Date.now()
        ? ["previous_"]
        : []),
    ];
    try {
      return slots
        .filter((prefix) => row[prefix + "secret_id"] !== null)
        .map((prefix) =>
          signingSecretSchema.parse({
            keyId: row[prefix + "signing_key_id"],
            secretId: row[prefix + "secret_id"],
            revision: row[prefix + "secret_revision"],
            envelope: {
              format: "aes-256-gcm-v1",
              keyId: row[prefix + "secret_key_id"],
              ciphertext: decodeBytea(row[prefix + "secret_ciphertext"]),
              nonce: decodeBytea(row[prefix + "secret_nonce"]),
              authTag: decodeBytea(row[prefix + "secret_auth_tag"]),
            },
          }),
        );
    } catch {
      throw new ConnectorError("unavailable");
    }
  }
  async validateProducts(
    orgId: string,
    productIds: readonly string[],
  ): Promise<void> {
    if (
      productIds.length === 0 ||
      new Set(productIds).size !== productIds.length
    )
      throw new ConnectorError("invalid_request");
    const result = await this.client()
      .from("products")
      .select("id", { count: "exact" })
      .eq("organization_id", orgId)
      .in("id", productIds);
    if (result.error) throw new ConnectorError("unavailable");
    if ((result.count ?? 0) !== productIds.length)
      throw new ConnectorError("not_found");
  }

  async existingCommandKeyId(
    orgId: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<string | null> {
    if (!idempotencyKey) return null;
    const result = await this.client()
      .from("webhook_endpoint_commands")
      .select("request_digest_key_id")
      .eq("organization_id", orgId)
      .eq("actor_user_id", actorId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (result.error) throw new ConnectorError("unavailable");
    if (!result.data) return null;
    return commandRowSchema.parse(result.data).request_digest_key_id;
  }

  async executeEndpointCommand(
    orgId: string,
    request: WebhookEndpointCommandRequest,
  ): Promise<WebhookEndpoint | WebhookDelivery> {
    const row = await this.rpc(
      orgId,
      "m1103_execute_webhook_endpoint_command_atomic",
      {
        p_endpoint_id: request.endpointId,
        p_actor_user_id: request.authorization.actorId,
        p_operation: request.operation,
        p_expected_version: request.expectedVersion,
        p_idempotency_key: request.idempotencyKey,
        p_request_digest: request.requestDigest,
        p_request_digest_key_id: request.requestDigestKeyId,
        p_permission_version: request.authorization.permissionVersion,
        p_payload: request.payload,
        p_reason: request.reason ?? null,
      },
    );
    assertOutcome(row, [
      "created",
      "updated",
      "replayed",
      "queued",
      "disabled",
      "enabled",
      "revoked",
    ]);
    const command = row.command as Record<string, unknown> | undefined;
    if (request.operation === "test" || request.operation === "replay")
      return webhookDeliverySchema.parse(row.delivery ?? command?.delivery);
    return webhookEndpointSchema.parse(row.endpoint);
  }

  async listDeliveries(
    orgId: string,
    endpointId: string,
    params: PageParams,
  ): Promise<Paged<WebhookDelivery>> {
    const page = pageInput(params);
    const result = await this.client()
      .from("webhook_deliveries")
      .select("*", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("endpoint_id", endpointId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page.from, page.to);
    if (result.error || !Array.isArray(result.data))
      throw new ConnectorError("unavailable");
    return pageRows(
      webhookDeliverySchema,
      result.data.map(deliveryJson),
      result.count ?? 0,
      params,
    );
  }

  async delivery(
    orgId: string,
    endpointId: string,
    deliveryId: string,
    params: PageParams,
  ) {
    const delivery = await this.client()
      .from("webhook_deliveries")
      .select("*")
      .eq("organization_id", orgId)
      .eq("endpoint_id", endpointId)
      .eq("id", deliveryId)
      .maybeSingle();
    if (delivery.error) throw new ConnectorError("unavailable");
    if (!delivery.data) throw new ConnectorError("not_found");
    const page = pageInput(params);
    const attempts = await this.client()
      .from("webhook_delivery_attempts")
      .select("*", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("delivery_row_id", deliveryId)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page.from, page.to);
    if (attempts.error || !Array.isArray(attempts.data))
      throw new ConnectorError("unavailable");
    return {
      delivery: webhookDeliverySchema.parse(deliveryJson(delivery.data)),
      attempts: pageRows(
        webhookAttemptSchema,
        attempts.data.map(attemptJson),
        attempts.count ?? 0,
        params,
      ),
    };
  }

  async deliveryContext(
    orgId: string,
    endpointId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryContext> {
    const result = await this.client()
      .from("webhook_deliveries")
      .select("*")
      .eq("organization_id", orgId)
      .eq("endpoint_id", endpointId)
      .eq("id", deliveryId)
      .maybeSingle();
    if (result.error) throw new ConnectorError("unavailable");
    if (!result.data) throw new ConnectorError("not_found");
    const row = result.data as Record<string, unknown>;
    return contextSchema.parse({
      delivery: deliveryJson(row),
      productIds: row.product_ids,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      destinationRevision: row.destination_revision,
      scopeRevision: row.scope_revision,
      destinationUrl: row.endpoint_url,
    });
  }
  async deliveryScopes(
    orgId: string,
    endpointId: string,
    deliveryIds: readonly string[],
  ) {
    if (deliveryIds.length === 0) return [];
    const result = await this.client().rpc("m1103_webhook_delivery_scopes", {
      p_organization_id: orgId,
      p_endpoint_id: endpointId,
      p_delivery_ids: deliveryIds,
    });
    if (
      result.error ||
      !Array.isArray(result.data) ||
      result.data.length !== deliveryIds.length
    )
      throw new ConnectorError("unavailable");
    const rows = z
      .array(
        z.object({
          delivery_id: z.string().uuid(),
          outcome: z.enum(["authorized_scope", "scope_unknown"]),
          product_ids: z.array(z.string().uuid()).max(100),
          resource: webhookResourceReferenceSchema.nullable(),
        }),
      )
      .parse(result.data);
    if (
      new Set(rows.map((row) => row.delivery_id)).size !== deliveryIds.length ||
      rows.some((row) => !deliveryIds.includes(row.delivery_id))
    )
      throw new ConnectorError("unavailable");
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      scope:
        row.outcome === "authorized_scope" &&
        row.product_ids.length > 0 &&
        row.resource
          ? { productIds: row.product_ids, resource: row.resource }
          : null,
    }));
  }
  async sourceScope(
    orgId: string,
    context: WebhookDeliveryContext,
  ): Promise<WebhookSourceScope> {
    const row = await this.rpc(orgId, "m1103_webhook_source_scope", {
      p_source_kind: context.sourceKind,
      p_source_id: context.sourceId,
      p_event_type: context.delivery.eventType,
    });
    assertOutcome(row, ["authorized_scope"]);
    return z
      .object({
        productIds: z.array(z.string().uuid()).min(1).max(100),
        resource: webhookResourceReferenceSchema,
      })
      .parse({ productIds: row.product_ids, resource: row.resource });
  }
  async previewReplay(
    orgId: string,
    endpointId: string,
    deliveryId: string,
    authorization: ConnectorAuthorization,
    expectedEndpointVersion: number,
    expectedDeliveryVersion: number,
  ) {
    const row = await this.rpc(orgId, "m1103_preview_webhook_replay", {
      p_endpoint_id: endpointId,
      p_delivery_id: deliveryId,
      p_actor_user_id: authorization.actorId,
      p_permission_version: authorization.permissionVersion,
      p_expected_endpoint_version: expectedEndpointVersion,
      p_expected_delivery_version: expectedDeliveryVersion,
    });
    assertOutcome(row, ["previewed"]);
    return webhookReplayPreviewSchema.parse(row.preview);
  }
  async permit(
    orgId: string,
    claim: ClaimedWebhookDelivery,
    authorization: ConnectorAuthorization,
    _scope: WebhookSourceScope,
    payload: string,
  ): Promise<void> {
    const row = await this.rpc(orgId, "m1103_prepare_webhook_delivery", {
      p_delivery_id: claim.delivery.id,
      p_worker_id: claim.workerId,
      p_generation: claim.leaseGeneration,
      p_actor_user_id: authorization.actorId,
      p_permission_version: authorization.permissionVersion,
      p_payload_bytes: payload,
      p_secret_revision: claim.endpoint.secretRevision,
    });
    assertOutcome(row, ["prepared"]);
  }

  async dueOrganizations(limit: number): Promise<readonly string[]> {
    const result = await this.client().rpc(
      "m1103_list_due_webhook_delivery_organizations",
      { p_limit: limit },
    );
    if (result.error || !Array.isArray(result.data))
      throw new ConnectorError("unavailable");
    return result.data.flatMap((row) => {
      const value =
        row && typeof row === "object"
          ? (row as { organization_id?: unknown }).organization_id
          : undefined;
      return typeof value === "string" ? [value] : [];
    });
  }

  async claim(
    orgId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<ClaimedWebhookDelivery | null> {
    const row = await this.rpc(orgId, "m1103_claim_webhook_delivery", {
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });
    if (row.outcome === "empty" || row.outcome === "canceled") return null;
    assertOutcome(row, ["claimed"]);
    return claimSchema.parse(row.result);
  }

  async complete(
    orgId: string,
    deliveryId: string,
    workerId: string,
    generation: number,
    result: { status: number; durationMs: number; responseBytes: number },
  ): Promise<void> {
    const row = await this.rpc(orgId, "m1103_complete_webhook_delivery", {
      p_delivery_id: deliveryId,
      p_worker_id: workerId,
      p_generation: generation,
      p_http_status: result.status,
      p_duration_ms: result.durationMs,
      p_response_bytes: result.responseBytes,
    });
    assertOutcome(row, ["succeeded"]);
  }

  async fail(
    orgId: string,
    deliveryId: string,
    workerId: string,
    generation: number,
    result: {
      category: string;
      code: string;
      status: number | null;
      durationMs: number;
      responseBytes: number;
      retryAfterSeconds: number | null;
    },
  ): Promise<void> {
    const row = await this.rpc(orgId, "m1103_fail_webhook_delivery", {
      p_delivery_id: deliveryId,
      p_worker_id: workerId,
      p_generation: generation,
      p_category: result.category,
      p_code: result.code,
      p_http_status: result.status,
      p_duration_ms: result.durationMs,
      p_response_bytes: result.responseBytes,
      p_retry_after_seconds: result.retryAfterSeconds,
    });
    assertOutcome(row, ["retrying", "failed"]);
  }

  private async rpc(
    orgId: string,
    name: string,
    input: Readonly<Record<string, unknown>>,
  ) {
    const result = await this.client().rpc(name, {
      ...input,
      p_organization_id: orgId,
    });
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1)
      throw new ConnectorError("unavailable");
    const row: unknown = result.data[0];
    if (!row || typeof row !== "object")
      throw new ConnectorError("unavailable");
    return row as Record<string, unknown>;
  }
}

function endpointJson(value: unknown): Record<string, unknown> {
  const row = value as Record<string, unknown>;
  return {
    id: row.id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    url: row.url,
    eventTypes: row.event_types,
    productIds: row.product_ids,
    enabled: row.enabled,
    status: !row.secret_ciphertext
      ? "secret_required"
      : row.enabled === false
        ? "disabled"
        : row.last_failure_category
          ? "degraded"
          : "active",
    hasSecret: Boolean(row.secret_ciphertext),
    retryPolicy: {
      maxAttempts: row.max_attempts,
      baseDelaySeconds: row.base_delay_seconds,
      maxDelaySeconds: row.max_delay_seconds,
    },
    scopeRevision: row.scope_revision,
    destinationRevision: row.destination_revision,
    previousSigningKeyId: row.previous_signing_key_id,
    previousKeyExpiresAt: utcTimestamp(row.previous_secret_expires_at),
    signingKeyId: row.signing_key_id,
    secretRevision: row.secret_revision,
    version: row.version,
    lastDeliveredAt: utcTimestamp(row.last_delivered_at),
    lastFailureCategory: row.last_failure_category,
    createdAt: utcTimestamp(row.created_at),
    updatedAt: utcTimestamp(row.updated_at),
  };
}
function deliveryJson(value: unknown): Record<string, unknown> {
  const row = value as Record<string, unknown>;
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    eventId: row.event_id,
    deliveryId: row.delivery_id,
    eventType: row.event_type,
    status: row.status,
    resource: {
      type: row.resource_type,
      id: row.resource_id,
      url: row.resource_url,
    },
    occurredAt: utcTimestamp(row.occurred_at),
    endpointVersion: row.endpoint_version,
    scopeRevision: row.scope_revision,
    destinationRevision: row.destination_revision,
    replayParentId: row.parent_delivery_id,
    deadlineAt: utcTimestamp(row.deadline_at),
    completedAt: utcTimestamp(row.completed_at),
    nextAttemptAt: ["pending", "retrying", "delivering"].includes(
      String(row.status),
    )
      ? utcTimestamp(row.next_attempt_at)
      : null,
    attemptCount: row.attempt_count,
    lastHttpStatus: row.last_http_status,
    lastFailureCategory: row.last_failure_category,
    lastFailureCode: row.last_failure_code,
    version: row.version,
    createdAt: utcTimestamp(row.created_at),
    updatedAt: utcTimestamp(row.updated_at),
  };
}
function attemptJson(value: unknown): Record<string, unknown> {
  const row = value as Record<string, unknown>;
  return {
    id: row.id,
    deliveryRowId: row.delivery_row_id,
    attemptNumber: row.attempt_number,
    leaseGeneration: row.lease_generation,
    startedAt: utcTimestamp(row.started_at),
    finishedAt: utcTimestamp(row.finished_at),
    outcome: row.outcome ?? "running",
    httpStatus: row.http_status,
    durationMs: row.duration_ms,
    failureCategory: row.failure_category,
    failureCode: row.failure_code,
    responseBytes: row.response_bytes,
  };
}
function pageInput(params: PageParams) {
  const pageSize = params.pageSize;
  const from = (params.page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}
function pageRows<T>(
  schema: z.ZodType<T>,
  rows: unknown[],
  total: number,
  params: PageParams,
): Paged<T> {
  return pagedSchema(schema).parse({
    rows,
    total,
    page: params.page,
    pageSize: params.pageSize,
    pageCount: Math.max(1, Math.ceil(total / params.pageSize)),
  });
}
function assertOutcome(
  row: Record<string, unknown>,
  success: readonly string[],
) {
  if (typeof row.outcome === "string" && success.includes(row.outcome)) return;
  const mapped = {
    not_found: "not_found",
    forbidden: "forbidden_by_policy",
    conflict: "conflict",
    idempotency_conflict: "idempotency_mismatch",
    invalid_request: "invalid_request",
    scope_unknown: "forbidden_by_policy",
    stale_preview: "stale_preview",
    already_running: "already_running",
    invalid_state: "invalid_state",
    lease_lost: "conflict",
  } as const;
  throw new ConnectorError(
    typeof row.outcome === "string" && row.outcome in mapped
      ? mapped[row.outcome as keyof typeof mapped]
      : "unavailable",
  );
}

function utcTimestamp(value: unknown): string | null {
  return typeof value === "string" ? new Date(value).toISOString() : null;
}

function decodeBytea(value: unknown): string {
  if (typeof value !== "string" || !/^\\x(?:[a-f0-9]{2})+$/i.test(value))
    throw new ConnectorError("unavailable");
  return Buffer.from(value.slice(2), "hex").toString("base64");
}
