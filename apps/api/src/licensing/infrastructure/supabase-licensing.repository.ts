import { createHash } from "node:crypto";
import {
  Injectable,
  ServiceUnavailableException,
  ForbiddenException,
} from "@nestjs/common";
import { z } from "zod";
import { licenseHistoryResponseSchema } from "@repo/contracts/licensing/schemas";
import type {
  LicenseHistoryQuery,
  LicenseHistoryResponse,
} from "@repo/contracts/licensing/types";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  licenseStoredStateSchema,
  type LicensingPort,
  type LicensePolicySynchronizationPort,
  type ActivationCommand,
  type ActivationReceipt,
  type ActivationReceiptLookup,
} from "../application/licensing.port";

const receiptSchema = z.object({
  outcome: z.enum([
    "activated",
    "replayed",
    "rejected",
    "conflict",
    "forbidden",
  ]),
  version: z.number().int().nonnegative().default(0),
  auditId: z.uuid().optional(),
  licenseId: z.uuid().optional(),
  reason: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,79}$/)
    .optional(),
});
const historySchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      sequence: z.union([z.number(), z.string()]),
      action: z.string(),
      outcome: z.string(),
      reason: z.string().nullable(),
      createdAt: z.string(),
      artifactDigest: z.string().nullable(),
      version: z.number(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }> & {
    abortSignal(
      signal: AbortSignal,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
}
/** Service-role adapter: every RPC receives verified tenant and actor first. */
@Injectable()
export class SupabaseLicensingRepository
  implements LicensingPort, LicensePolicySynchronizationPort
{
  constructor(private readonly supabase: SupabaseService) {}
  async listPolicyTenants(limit: number, after: string | null) {
    const input = z
      .object({
        limit: z.number().int().min(1).max(100),
        after: z.uuid().nullable(),
      })
      .parse({ limit, after });
    return z
      .object({
        organizationIds: z.array(z.uuid()).max(input.limit),
        nextCursor: z.uuid().nullable(),
      })
      .strict()
      .parse(
        await this.rpc("m15_01_policy_tenants", {
          p_limit: input.limit,
          p_after: input.after,
        }),
      );
  }
  async listWorkerCandidateOrganizations(
    capability: string,
    limit: number,
    policyRevision: number,
    configurationDigest: string,
  ) {
    return z
      .array(z.uuid())
      .max(100)
      .parse(
        await this.rpc("m15_01_worker_candidates", {
          p_capability: capability,
          p_limit: limit,
          p_policy_revision: policyRevision,
          p_configuration_digest: configurationDigest,
        }),
      );
  }
  async publishVerification(
    orgId: string,
    actorId: string | null,
    proof: Parameters<LicensingPort["publishVerification"]>[2],
    signal?: AbortSignal,
  ) {
    return z
      .object({
        outcome: z.enum(["updated", "stale", "conflict", "forbidden"]),
      })
      .parse(
        await this.rpc(
          "m15_01_checkpoint_verification",
          {
            p_organization_id: orgId,
            p_actor_user_id: actorId,
            p_version: proof.version,
            p_artifact_digest: proof.digest,
            p_verified: proof.verified,
            p_effective_capabilities: proof.capabilities,
            p_policy_revision: proof.policyRevision,
            p_configuration_digest: proof.configurationDigest,
            p_observed_at: proof.observedAt,
          },
          signal,
        ),
      );
  }
  async getWorkerState(orgId: string, signal?: AbortSignal) {
    return licenseStoredStateSchema.parse(
      await this.rpc(
        "m15_01_get_worker_state",
        { p_organization_id: orgId },
        signal,
      ),
    );
  }
  async checkpointWorker(
    orgId: string,
    observedAt: string,
    signal?: AbortSignal,
  ) {
    return z
      .object({
        timeHighWaterAt: z.string().nullable(),
        clockRollbackDetected: z.boolean(),
      })
      .parse(
        await this.rpc(
          "m15_01_checkpoint_worker_time",
          {
            p_organization_id: orgId,
            p_observed_at: observedAt,
          },
          signal,
        ),
      );
  }
  async getState(orgId: string, actorId: string, signal?: AbortSignal) {
    return licenseStoredStateSchema.parse(
      await this.rpc(
        "m15_01_get_state",
        {
          p_organization_id: orgId,
          p_actor_user_id: actorId,
        },
        signal,
      ),
    );
  }
  async activationReceipt(
    orgId: string,
    actorId: string,
    request: ActivationReceiptLookup,
  ): Promise<ActivationReceipt | { outcome: "absent" }> {
    return z
      .union([receiptSchema, z.object({ outcome: z.literal("absent") })])
      .parse(
        await this.rpc("m15_01_activation_receipt", {
          p_organization_id: orgId,
          p_actor_user_id: actorId,
          p_artifact: request.artifact,
          p_artifact_digest: request.digest,
          p_idempotency_key: request.idempotencyKey,
          p_request_digest: request.requestDigest,
        }),
      );
  }
  async activate(
    orgId: string,
    actorId: string,
    command: ActivationCommand,
  ): Promise<ActivationReceipt> {
    const objectPath = command.claims
      ? await this.archive(orgId, command.digest, command.artifact)
      : null;
    return receiptSchema.parse(
      await this.rpc("m15_01_activate", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_artifact: command.artifact,
        p_artifact_digest: command.digest,
        p_verified_claims: command.claims,
        p_expected_version: command.expectedVersion,
        p_idempotency_key: command.idempotencyKey,
        p_request_digest: command.requestDigest,
        p_rejection_reason: command.rejectionReason,
        p_artifact_object_path: objectPath,
      }),
    );
  }
  async history(
    orgId: string,
    actorId: string,
    query: LicenseHistoryQuery,
  ): Promise<LicenseHistoryResponse> {
    // SQL keyset cursor is a decimal audit sequence, never an unvalidated SQL fragment.
    if (query.cursor && !/^\d{1,19}$/.test(query.cursor))
      throw new ForbiddenException({
        code: "licensing_invalid_cursor",
        message: "Licence history cursor is invalid",
      });
    const result = historySchema.parse(
      await this.rpc("m15_01_history", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_limit: query.limit,
        p_cursor: query.cursor ?? null,
      }),
    );
    return licenseHistoryResponseSchema.parse({
      items: result.items.map((item) => ({
        id: item.id,
        occurredAt: new Date(item.createdAt).toISOString(),
        action: ["rejected", "denied"].includes(item.outcome)
          ? "rejected"
          : "activated",
        reason: item.reason,
        digest: item.artifactDigest,
      })),
      nextCursor: result.nextCursor,
    });
  }
  async archive(
    orgId: string,
    digest: string,
    artifact: string,
  ): Promise<string> {
    const path = `${orgId}/${digest}.jws`;
    const bucket = this.supabase.admin().storage.from("licence-artifacts");
    // Deterministic immutable path makes concurrent retries safe. Verify bytes even after duplicate upload.
    await bucket.upload(path, Buffer.from(artifact, "utf8"), {
      upsert: false,
      contentType: "application/jose",
    });
    const { data, error } = await bucket.download(path);
    if (
      error ||
      !data ||
      createHash("sha256")
        .update(Buffer.from(await data.arrayBuffer()))
        .digest("hex") !== digest
    )
      throw new ServiceUnavailableException({
        code: "unavailable",
        message: "Licence evidence archive is unavailable",
      });
    return path;
  }
  async checkpoint(
    orgId: string,
    actorId: string,
    observedAt: string,
    signal?: AbortSignal,
  ) {
    return z
      .object({
        timeHighWaterAt: z.string().nullable(),
        clockRollbackDetected: z.boolean(),
      })
      .parse(
        await this.rpc(
          "m15_01_checkpoint_time",
          {
            p_organization_id: orgId,
            p_actor_user_id: actorId,
            p_observed_at: observedAt,
          },
          signal,
        ),
      );
  }
  private async rpc(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const client = this.supabase.admin() as unknown as RpcClient;
    signal?.throwIfAborted();
    const query = client.rpc(name, args);
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    signal?.throwIfAborted();
    if (
      (error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "42501") ||
      (data &&
        typeof data === "object" &&
        "outcome" in data &&
        data.outcome === "forbidden")
    )
      throw new ForbiddenException({
        code: "forbidden",
        message: "Licence authority is not available to this identity",
      });
    if (error)
      throw new ServiceUnavailableException({
        code: "unavailable",
        message: "Licence authority is unavailable",
      });
    return data;
  }
}
