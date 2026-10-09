import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ConnectorSecretEnvelope } from "../../../connectors/application/connector-vault.port";
import type {
  ConnectorVaultMaintenanceStore,
  ConnectorVaultKeyReferences,
  StoredConnectorEnvelope,
} from "../../../connectors/infrastructure/connector-vault-maintenance";
const id = z.uuid();
const envelopeSchema = z
  .object({
    format: z.literal("aes-256-gcm-v1"),
    keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
    ciphertext: z.string().min(1).max(106672),
    nonce: z.string().min(1).max(32),
    authTag: z.string().min(1).max(32),
  })
  .strict();
const rowSchema = envelopeSchema
  .extend({
    destinationId: id,
    secretId: id,
    credentialRevision: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const counts = z
  .record(
    z.string().min(1).max(80),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  )
  .refine((v) => Object.keys(v).length <= 100);
const refsSchema = z
  .object({
    envelopeKeyReferences: counts,
    commandKeyReferences: counts,
    legacyEnvelopeCount: z.literal(0),
    hasMoreKeys: z.boolean(),
  })
  .strict();
/** Operator-only organization-scoped envelope maintenance. No browser route. */
export class SupabaseSiemVaultMaintenanceStore implements ConnectorVaultMaintenanceStore {
  constructor(private readonly client: SupabaseClient) {}
  async keyReferences(orgId: string): Promise<ConnectorVaultKeyReferences> {
    return refsSchema.parse(await this.call(orgId, "references", {}));
  }
  async list(
    orgId: string,
    afterId: string | null,
    limit: number,
  ): Promise<readonly StoredConnectorEnvelope[]> {
    id.parse(orgId);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (afterId !== null && !id.safeParse(afterId).success)
    )
      throw new Error("Invalid maintenance pagination");
    const rows = z
      .array(rowSchema)
      .parse(await this.call(orgId, "list", { afterId, limit }));
    if (
      rows.length > limit ||
      rows.some(
        (row, index) =>
          (afterId !== null && row.secretId <= afterId) ||
          (index > 0 && row.secretId <= rows[index - 1]!.secretId),
      )
    )
      throw new Error("Invalid maintenance page");
    return rows.map(({ destinationId, ...row }) => ({
      ...row,
      orgId,
      connectorId: `siem:${destinationId}`,
    }));
  }
  async replace(
    orgId: string,
    previous: StoredConnectorEnvelope,
    next: ConnectorSecretEnvelope,
  ): Promise<"rewrapped" | "conflict"> {
    id.parse(orgId);
    if (previous.orgId !== orgId)
      throw new Error("Maintenance tenant mismatch");
    const destinationId = previous.connectorId.startsWith("siem:")
      ? previous.connectorId.slice(5)
      : "";
    id.parse(destinationId);
    id.parse(previous.secretId);
    if (previous.format !== "aes-256-gcm-v1")
      throw new Error("Maintenance format mismatch");
    const expectedEnvelope = envelopeSchema.parse({
      format: previous.format,
      keyId: previous.keyId,
      ciphertext: previous.ciphertext,
      nonce: previous.nonce,
      authTag: previous.authTag,
    });
    const result = z
      .object({
        outcome: z.enum([
          "updated",
          "conflict",
          "not_found",
          "invalid_request",
        ]),
      })
      .strict()
      .parse(
        await this.call(orgId, "replace", {
          destinationId,
          secretId: previous.secretId,
          credentialRevision: previous.credentialRevision,
          expectedEnvelope,
          nextEnvelope: envelopeSchema.parse(next),
        }),
      );
    if (result.outcome === "invalid_request")
      throw new Error("SIEM vault maintenance rejected");
    return result.outcome === "updated" ? "rewrapped" : "conflict";
  }
  private async call(
    orgId: string,
    action: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    id.parse(orgId);
    const result = z.object({ data: z.unknown(), error: z.unknown() }).parse(
      await this.client.rpc("m13_05_siem_vault", {
        p_organization_id: orgId,
        p_action: action,
        p_input: input,
      }),
    );
    if (result.error) throw new Error("SIEM vault maintenance failed");
    return result.data;
  }
}
