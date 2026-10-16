import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ConnectorSecretEnvelope } from "../application/connector-vault.port";
import type {
  ConnectorVaultMaintenanceStore,
  ConnectorVaultKeyReferences,
  StoredConnectorEnvelope,
} from "./connector-vault-maintenance";

const envelopeSchema = z
  .object({
    format: z.literal("aes-256-gcm-v1"),
    keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
    ciphertext: z.string().min(1).max(106_672),
    nonce: z.string().min(1).max(32),
    authTag: z.string().min(1).max(32),
  })
  .strict();
const rowSchema = envelopeSchema
  .extend({
    secretId: z.string().uuid(),
    endpointId: z.string().uuid(),
    credentialRevision: z.number().int().positive(),
  })
  .strict();
const countsSchema = z
  .record(
    z.string().min(1).max(80),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  )
  .refine((values) => Object.keys(values).length <= 100);
const referencesSchema = z
  .object({
    envelopeKeyReferences: countsSchema,
    commandKeyReferences: countsSchema,
    legacyEnvelopeCount: z.literal(0),
    hasMoreKeys: z.boolean(),
  })
  .strict();
const rpcResultSchema = z.object({ data: z.unknown(), error: z.unknown() });

/** Maintenance-only service RPCs. Both slots use the public signing UUID as AAD. */
export class SupabaseWebhookVaultMaintenanceStore implements ConnectorVaultMaintenanceStore {
  constructor(private readonly client: SupabaseClient) {}

  async keyReferences(orgId: string): Promise<ConnectorVaultKeyReferences> {
    this.scope(orgId);
    const { data, error } = rpcResultSchema.parse(
      await this.client.rpc("m1103_webhook_key_references", {
        p_organization_id: orgId,
      }),
    );
    if (error) throw new Error("Webhook vault key reference read failed");
    return referencesSchema.parse(data);
  }

  async list(
    orgId: string,
    afterId: string | null,
    limit: number,
  ): Promise<readonly StoredConnectorEnvelope[]> {
    this.scope(orgId);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (afterId !== null && !z.string().uuid().safeParse(afterId).success)
    )
      throw new Error("Invalid maintenance pagination");
    const { data, error } = rpcResultSchema.parse(
      await this.client.rpc("m1103_list_webhook_secret_envelopes", {
        p_organization_id: orgId,
        p_after_id: afterId,
        p_limit: limit,
      }),
    );
    if (error) throw new Error("Webhook vault maintenance read failed");
    const rows = z.array(rowSchema).parse(data);
    if (
      rows.length > limit ||
      rows.some(
        (row, index) =>
          (afterId !== null && row.secretId <= afterId) ||
          (index > 0 && row.secretId <= rows[index - 1]!.secretId),
      )
    )
      throw new Error("Invalid maintenance page");
    return rows.map(({ endpointId, ...row }) => ({
      ...row,
      orgId,
      connectorId: `webhook:${endpointId}`,
    }));
  }

  async replace(
    orgId: string,
    previous: StoredConnectorEnvelope,
    next: ConnectorSecretEnvelope,
  ): Promise<"rewrapped" | "conflict"> {
    this.scope(orgId);
    if (orgId !== previous.orgId)
      throw new Error("Webhook vault maintenance tenant mismatch");
    const endpointId = previous.connectorId.startsWith("webhook:")
      ? previous.connectorId.slice("webhook:".length)
      : "";
    if (
      !z.string().uuid().safeParse(endpointId).success ||
      !z.string().uuid().safeParse(previous.secretId).success
    )
      throw new Error("Webhook vault maintenance identity mismatch");
    if (previous.format !== "aes-256-gcm-v1")
      throw new Error("Webhook vault maintenance format mismatch");
    const expectedEnvelope = envelopeSchema.parse({
      format: previous.format,
      keyId: previous.keyId,
      ciphertext: previous.ciphertext,
      nonce: previous.nonce,
      authTag: previous.authTag,
    });
    const { data, error } = rpcResultSchema.parse(
      await this.client.rpc("m1103_rewrap_webhook_secret_atomic", {
        p_organization_id: orgId,
        p_endpoint_id: endpointId,
        p_secret_id: previous.secretId,
        p_expected_revision: previous.credentialRevision,
        p_expected_envelope: expectedEnvelope,
        p_next_envelope: envelopeSchema.parse(next),
      }),
    );
    if (error) throw new Error("Webhook vault maintenance update failed");
    const rows = z
      .array(
        z
          .object({
            outcome: z.enum([
              "updated",
              "not_found",
              "conflict",
              "invalid_request",
            ]),
          })
          .strict(),
      )
      .parse(data);
    if (rows.length !== 1 || rows[0]!.outcome === "invalid_request")
      throw new Error("Webhook vault maintenance update rejected");
    return rows[0]!.outcome === "updated" ? "rewrapped" : "conflict";
  }

  private scope(orgId: string): void {
    if (!z.string().uuid().safeParse(orgId).success)
      throw new Error("Invalid maintenance scope");
  }
}
