import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import { NotificationDispatchFailure } from "./notification-dispatch-worker";
import type { DigestNotificationDispatchWorkerDependencies } from "./digest-notification-dispatch-worker";

type Queue = DigestNotificationDispatchWorkerDependencies["queue"];
type RpcRow = Readonly<Record<string, unknown>>;

const uuid = z.uuid();
const pageSize = 100;
const positiveCount = z.number().int().min(0).max(10_000);
const claimSchema = z
  .object({
    batchId: uuid,
    leaseOwner: uuid,
    checkpointVersion: z.number().int().positive(),
  })
  .strict();
const digestItemSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    href: z
      .string()
      .regex(/^\/(?!\/)[^\r\n]*$/)
      .max(2048),
    date: z.iso.date(),
    category: z.enum(["finding_triage", "evidence", "supplier_owner"]),
  })
  .strict();
const readySchema = z
  .object({
    deliveryRef: uuid,
    idempotencyKey: z.string().trim().min(1).max(200),
    recipient: z.object({ userId: uuid, email: z.email().max(320) }).strict(),
    payload: z
      .object({
        kind: z.literal("digest"),
        items: z.array(digestItemSchema).min(1).max(100),
      })
      .strict(),
  })
  .strict();

/** Treats every service-role RPC response as an untrusted boundary. */
@Injectable()
export class SupabaseNotificationDigestQueueAdapter implements Queue {
  constructor(private readonly supabase: SupabaseService) {}

  async reconcileAmbiguousLeases(): ReturnType<
    Queue["reconcileAmbiguousLeases"]
  > {
    const row = await this.one(
      "reconcile_notification_ambiguous_leases_atomic",
      { p_limit: 1000 },
    );
    const parsed = z
      .object({
        outcome: z.literal("reconciled"),
        dispatches: positiveCount,
        digests: positiveCount,
      })
      .passthrough()
      .safeParse(row);
    if (!parsed.success) throw malformedProvider();
    return Object.freeze({
      outcome: parsed.data.outcome,
      dispatches: parsed.data.dispatches,
      digests: parsed.data.digests,
    });
  }

  async dueOrganizations(
    afterOrganizationId: string | null,
  ): ReturnType<Queue["dueOrganizations"]> {
    if (
      afterOrganizationId !== null &&
      !uuid.safeParse(afterOrganizationId).success
    )
      throw malformedProvider();
    const data = await this.rpc(
      "list_due_notification_digest_organizations_atomic",
      {
        p_after_organization_id: afterOrganizationId,
        p_limit: pageSize,
      },
    );
    const parsed = z
      .array(z.object({ organization_id: uuid }).passthrough())
      .max(pageSize)
      .safeParse(data);
    if (!parsed.success) throw malformedProvider();
    const organizationIds = parsed.data.map(
      ({ organization_id }) => organization_id,
    );
    let previous = afterOrganizationId;
    for (const organizationId of organizationIds) {
      if (previous !== null && organizationId <= previous)
        throw malformedProvider();
      previous = organizationId;
    }
    return Object.freeze({
      organizationIds: Object.freeze(organizationIds),
      nextOrganizationId:
        organizationIds.length === pageSize
          ? (organizationIds.at(-1) ?? null)
          : null,
    });
  }

  async schedule(organizationId: string): ReturnType<Queue["schedule"]> {
    if (!uuid.safeParse(organizationId).success) throw malformedProvider();
    const row = await this.one("schedule_notification_digest_batches_atomic", {
      p_organization_id: organizationId,
      p_limit: 1000,
    });
    const parsed = z
      .object({
        outcome: z.enum(["scheduled", "legacy"]),
        created: positiveCount,
        cancelled: positiveCount,
        deferred: positiveCount,
      })
      .passthrough()
      .safeParse(row);
    if (!parsed.success) throw malformedProvider();
    return Object.freeze({
      outcome: parsed.data.outcome,
      created: parsed.data.created,
    });
  }

  async claim(
    input: Parameters<Queue["claim"]>[0],
  ): ReturnType<Queue["claim"]> {
    if (input.leaseSeconds < 30 || input.leaseSeconds > 900)
      throw malformedProvider();
    const row = await this.one("claim_notification_digest_batch_atomic", {
      p_organization_id: input.organizationId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    });
    if (row.outcome === "none_available" || row.outcome === "conflict")
      return Object.freeze({ outcome: row.outcome });
    if (row.outcome !== "claimed") throw malformedProvider();
    const parsed = claimSchema.safeParse(row.batch);
    if (!parsed.success || parsed.data.leaseOwner !== input.workerId)
      throw malformedProvider();
    return Object.freeze({ outcome: "claimed" as const, ...parsed.data });
  }

  async prepare(
    input: Parameters<Queue["prepare"]>[0],
  ): ReturnType<Queue["prepare"]> {
    const row = await this.one("prepare_notification_digest_batch_atomic", {
      p_organization_id: input.organizationId,
      p_batch_id: input.batchId,
      p_worker_id: input.leaseOwner,
      p_expected_version: input.checkpointVersion,
    });
    if (
      row.outcome === "cancelled" ||
      row.outcome === "deferred" ||
      row.outcome === "conflict" ||
      row.outcome === "not_found"
    ) {
      return Object.freeze({ outcome: row.outcome });
    }
    if (row.outcome !== "ready") throw malformedProvider();
    const parsed = readySchema.safeParse(row.delivery);
    if (
      !parsed.success ||
      parsed.data.deliveryRef !== input.batchId ||
      parsed.data.idempotencyKey !== `notification-digest:${input.batchId}`
    )
      throw malformedProvider();
    return Object.freeze({
      outcome: "ready" as const,
      recipient: Object.freeze(parsed.data.recipient),
      idempotencyKey: parsed.data.idempotencyKey,
      payload: Object.freeze(parsed.data.payload),
    });
  }

  async complete(
    input: Parameters<Queue["complete"]>[0],
  ): ReturnType<Queue["complete"]> {
    if (
      input.messageIdHash !== null &&
      !/^[a-f0-9]{64}$/.test(input.messageIdHash)
    )
      throw malformedProvider();
    const row = await this.one("complete_notification_digest_batch_atomic", {
      p_organization_id: input.organizationId,
      p_batch_id: input.batchId,
      p_worker_id: input.leaseOwner,
      p_expected_version: input.checkpointVersion,
      p_outcome: "provider_accepted",
      p_message_id_hash: input.messageIdHash,
      p_error_code: null,
    });
    if (row.outcome === "completed" || row.outcome === "replayed")
      return Object.freeze({ outcome: "completed" as const });
    if (row.outcome === "conflict" || row.outcome === "not_found")
      return Object.freeze({ outcome: "conflict" as const });
    throw malformedProvider();
  }

  async fail(input: Parameters<Queue["fail"]>[0]): ReturnType<Queue["fail"]> {
    const safeCode = [
      "provider_unavailable",
      "delivery_failed",
      "malformed_provider",
    ].includes(input.code)
      ? input.code
      : "provider_unavailable";
    const row = await this.one("fail_notification_digest_batch_atomic", {
      p_organization_id: input.organizationId,
      p_batch_id: input.batchId,
      p_worker_id: input.leaseOwner,
      p_expected_version: input.checkpointVersion,
      p_error_code: safeCode,
      p_retryable: input.retryable,
    });
    if (
      row.outcome === "retry_scheduled" ||
      row.outcome === "exhausted" ||
      row.outcome === "conflict"
    ) {
      return Object.freeze({ outcome: row.outcome });
    }
    throw malformedProvider();
  }

  private async one(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<RpcRow> {
    const data = await this.rpc(name, args);
    if (
      !Array.isArray(data) ||
      data.length !== 1 ||
      !data[0] ||
      typeof data[0] !== "object" ||
      Array.isArray(data[0])
    ) {
      throw malformedProvider();
    }
    return data[0] as RpcRow;
  }

  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    try {
      const result = await (
        this.supabase.admin() as unknown as {
          rpc(
            procedure: string,
            parameters: Readonly<Record<string, unknown>>,
          ): Promise<Readonly<{ data: unknown; error: unknown }>>;
        }
      ).rpc(name, args);
      if (result.error) throw providerUnavailable();
      return result.data;
    } catch {
      throw providerUnavailable();
    }
  }
}

function malformedProvider(): NotificationDispatchFailure {
  return new NotificationDispatchFailure("malformed_provider", false);
}

function providerUnavailable(): NotificationDispatchFailure {
  return new NotificationDispatchFailure("provider_unavailable", true);
}
