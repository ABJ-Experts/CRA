import { Injectable } from "@nestjs/common";
import { trustedNotificationRouteSchema } from "@repo/contracts/notifications";
import { z } from "zod";
import { AesGcmConnectorVault } from "../../connectors/infrastructure/connector-vault";
import { SupabaseService } from "../../supabase/supabase.service";
import type { ChatCredential } from "./chat-provider-delivery.adapter";
import type { ChatNotificationWorkerDependencies } from "./chat-notification-worker";

type Queue = ChatNotificationWorkerDependencies["queue"];
type Rpc = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
};
const uuid = z.uuid();
const pageSize = 100;
const sha256 = /^[a-f0-9]{64}$/;
const envelopeSchema = z
  .object({
    format: z.literal("aes-256-gcm-v1"),
    keyId: z.string().min(1),
    ciphertext: z.string().min(1),
    nonce: z.string().min(1),
    authTag: z.string().min(1),
  })
  .strict();
const preparedSchema = z
  .object({
    channelId: uuid,
    mode: z.enum([
      "slack_webhook",
      "slack_bot",
      "teams_workflow_webhook",
      "teams_bot_proactive",
    ]),
    targetMetadata: z.record(z.string(), z.unknown()),
    credentialEnvelope: envelopeSchema,
    credentialRevision: z.number().int().positive(),
    eventClass: z.enum([
      "high_severity_alert",
      "countdown_warning",
      "approval_prompt",
    ]),
    severity: z.enum(["high", "critical"]),
    effectiveAt: z.iso.datetime({ offset: true }),
    appPath: trustedNotificationRouteSchema,
  })
  .strict();
const slackBotTargetSchema = z
  .object({ channelId: z.string().regex(/^[CGD][A-Z0-9]{1,40}$/) })
  .strict();
const teamsBotTargetSchema = z
  .object({
    tenantId: uuid,
    appId: uuid,
    conversationId: z.string().min(1).max(500),
    serviceUrl: z.url().max(2048),
  })
  .strict();

function invalid(): Error {
  return new Error("Chat queue returned an invalid response");
}

/** Parses tenant-scoped SQL output before any credential or link reaches a provider. */
@Injectable()
export class SupabaseChatNotificationQueueAdapter implements Queue {
  private readonly appOrigin: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly vault: AesGcmConnectorVault,
    appUrl: string,
  ) {
    const base = new URL(appUrl);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/" ||
      (base.protocol !== "https:" &&
        !(
          base.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(base.hostname)
        ))
    ) {
      throw new Error("Invalid chat application origin");
    }
    this.appOrigin = base.origin;
  }

  async dueOrganizations(
    afterOrganizationId: string | null,
  ): ReturnType<Queue["dueOrganizations"]> {
    if (
      afterOrganizationId !== null &&
      !uuid.safeParse(afterOrganizationId).success
    )
      throw invalid();
    const data = await this.rpc("m12_05_due_chat_organizations", {
      p_limit: pageSize,
      p_after_org: afterOrganizationId,
    });
    const rows = z
      .array(z.object({ organization_id: uuid }).strict())
      .max(pageSize)
      .safeParse(data);
    if (!rows.success) throw invalid();
    let previous = afterOrganizationId;
    for (const row of rows.data) {
      if (previous !== null && row.organization_id <= previous) throw invalid();
      previous = row.organization_id;
    }
    return {
      organizationIds: rows.data.map((row) => row.organization_id),
      nextOrganizationId:
        rows.data.length === pageSize
          ? (rows.data.at(-1)?.organization_id ?? null)
          : null,
    };
  }

  async bridge(organizationId: string): Promise<void> {
    if (!uuid.safeParse(organizationId).success) throw invalid();
    const count = await this.rpc("m12_05_bridge_chat_deliveries_atomic", {
      p_organization_id: organizationId,
      p_limit: pageSize,
    });
    if (
      !Number.isInteger(count) ||
      (count as number) < 0 ||
      (count as number) > pageSize
    )
      throw invalid();
  }

  async claim(
    input: Parameters<Queue["claim"]>[0],
  ): ReturnType<Queue["claim"]> {
    this.validateScope(input.organizationId, input.workerId);
    const response = await this.rpc("m12_05_claim_chat_delivery_atomic", {
      p_organization_id: input.organizationId,
      p_lease_owner: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    });
    const row = z
      .object({ outcome: z.string(), result: z.unknown().optional() })
      .passthrough()
      .safeParse(response);
    if (!row.success) throw invalid();
    if (
      row.data.outcome === "none_available" ||
      row.data.outcome === "conflict"
    ) {
      return { outcome: row.data.outcome };
    }
    if (row.data.outcome !== "claimed") throw invalid();
    const result = z
      .object({
        deliveryId: uuid,
        checkpointVersion: z.number().int().positive(),
      })
      .passthrough()
      .safeParse(row.data.result);
    if (!result.success) throw invalid();
    return { outcome: "claimed", ...result.data };
  }

  async prepare(
    input: Parameters<Queue["prepare"]>[0],
  ): ReturnType<Queue["prepare"]> {
    this.validateScope(input.organizationId, input.workerId);
    if (!uuid.safeParse(input.deliveryId).success) throw invalid();
    const response = await this.rpc("m12_05_prepare_chat_delivery_atomic", {
      p_organization_id: input.organizationId,
      p_delivery_id: input.deliveryId,
      p_lease_owner: input.workerId,
      p_checkpoint_version: input.checkpointVersion,
    });
    const row = z
      .object({ outcome: z.string(), result: z.unknown().optional() })
      .passthrough()
      .safeParse(response);
    if (!row.success) throw invalid();
    if (["cancelled", "conflict", "not_found"].includes(row.data.outcome)) {
      return {
        outcome: row.data.outcome as "cancelled" | "conflict" | "not_found",
      };
    }
    if (row.data.outcome !== "ready") throw invalid();
    const parsed = preparedSchema.safeParse(row.data.result);
    if (!parsed.success) throw invalid();
    const item = parsed.data;
    const secret = this.vault.decrypt(
      {
        orgId: input.organizationId,
        connectorId: item.channelId,
        secretId: item.channelId,
        credentialRevision: item.credentialRevision,
      },
      item.credentialEnvelope,
    );
    const credential = this.credential(item.mode, item.targetMetadata, secret);
    return {
      outcome: "ready",
      credential,
      message: {
        eventClass: item.eventClass,
        severity: item.severity,
        eventAt: item.effectiveAt,
        link: new URL(item.appPath, this.appOrigin).toString(),
      },
    };
  }

  async complete(
    input: Parameters<Queue["complete"]>[0],
  ): ReturnType<Queue["complete"]> {
    this.validateScope(input.organizationId, input.workerId);
    if (
      !uuid.safeParse(input.deliveryId).success ||
      (input.providerMessageIdHash !== null &&
        !sha256.test(input.providerMessageIdHash))
    )
      throw invalid();
    const response = await this.rpc("m12_05_complete_chat_delivery_atomic", {
      p_organization_id: input.organizationId,
      p_delivery_id: input.deliveryId,
      p_lease_owner: input.workerId,
      p_checkpoint_version: input.checkpointVersion,
      p_status: input.status,
      p_safe_error_code: input.safeErrorCode,
      p_provider_message_id_hash: input.providerMessageIdHash,
      p_retry_after_seconds: input.retryAfterSeconds,
    });
    const row = z
      .object({ outcome: z.string() })
      .passthrough()
      .safeParse(response);
    if (!row.success) throw invalid();
    if (row.data.outcome === "completed" || row.data.outcome === "replayed")
      return { outcome: "completed" };
    if (row.data.outcome === "conflict" || row.data.outcome === "not_found")
      return { outcome: "conflict" };
    throw invalid();
  }

  async revalidate(
    input: Parameters<Queue["revalidate"]>[0],
  ): ReturnType<Queue["revalidate"]> {
    this.validateScope(input.organizationId, input.workerId);
    if (!uuid.safeParse(input.deliveryId).success) throw invalid();
    const response = await this.rpc("m12_05_revalidate_chat_delivery_atomic", {
      p_organization_id: input.organizationId,
      p_delivery_id: input.deliveryId,
      p_lease_owner: input.workerId,
      p_checkpoint_version: input.checkpointVersion,
    });
    if (typeof response !== "boolean") throw invalid();
    return response;
  }

  private credential(
    mode: z.infer<typeof preparedSchema>["mode"],
    target: Record<string, unknown>,
    secret: string,
  ): ChatCredential {
    if (mode === "slack_webhook") return { mode, webhookUrl: secret };
    if (mode === "teams_workflow_webhook") return { mode, webhookUrl: secret };
    if (mode === "slack_bot") {
      const result = slackBotTargetSchema.safeParse(target);
      if (!result.success) throw invalid();
      return { mode, botToken: secret, channelId: result.data.channelId };
    }
    const result = teamsBotTargetSchema.safeParse(target);
    if (!result.success) throw invalid();
    return { mode, appSecret: secret, ...result.data };
  }

  private validateScope(organizationId: string, workerId: string): void {
    if (
      !uuid.safeParse(organizationId).success ||
      !uuid.safeParse(workerId).success
    )
      throw invalid();
  }

  private async rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const { data, error } = await (this.supabase.admin() as unknown as Rpc).rpc(
      name,
      args,
    );
    if (error) throw new Error("Chat storage is unavailable");
    return data;
  }
}
