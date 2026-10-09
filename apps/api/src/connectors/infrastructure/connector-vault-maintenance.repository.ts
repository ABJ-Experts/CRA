import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { ConnectorSecretEnvelope } from "../application/connector-vault.port";
import type {
  ConnectorVaultMaintenanceStore,
  ConnectorVaultKeyReferences,
  StoredConnectorEnvelope,
} from "./connector-vault-maintenance";

const rowSchema = z
  .object({
    secretId: z.string().uuid(),
    connectorId: z.string().uuid(),
    credentialRevision: z.number().int().positive(),
    keyId: z.string().nullable(),
    ciphertext: z.string(),
    nonce: z.string().nullable(),
    authTag: z.string().nullable(),
    format: z.enum(["legacy-pgp", "aes-256-gcm-v1"]),
    revokedAt: z.string().nullable(),
  })
  .strict();
const rpcResultSchema = z.object({ data: z.unknown(), error: z.unknown() });

/** Restricted maintenance-only RPCs; every call carries an organization fence. */
export class SupabaseConnectorVaultMaintenanceStore implements ConnectorVaultMaintenanceStore {
  constructor(private readonly client: SupabaseClient) {}

  async keyReferences(orgId: string): Promise<ConnectorVaultKeyReferences> {
    const { data, error } = rpcResultSchema.parse(
      await this.client.rpc("m11_connector_key_references", {
        p_organization_id: orgId,
      }),
    );
    if (error) throw new Error("Connector vault key reference read failed");
    const counts = z
      .record(
        z.string().min(1).max(80),
        z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      )
      .refine((values) => Object.keys(values).length <= 100);
    return z
      .object({
        envelopeKeyReferences: counts,
        commandKeyReferences: counts,
        legacyEnvelopeCount: z.number().int().nonnegative(),
        hasMoreKeys: z.boolean(),
      })
      .strict()
      .parse(data);
  }

  async list(
    orgId: string,
    afterId: string | null,
    limit: number,
  ): Promise<readonly StoredConnectorEnvelope[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid maintenance pagination");
    const { data, error } = rpcResultSchema.parse(
      await this.client.rpc("m11_list_connector_secret_envelopes", {
        p_organization_id: orgId,
        p_after_id: afterId,
        p_limit: limit,
      }),
    );
    if (error) throw new Error("Connector vault maintenance read failed");
    return z
      .array(rowSchema)
      .parse(data)
      .map((row): StoredConnectorEnvelope => {
        const context = {
          orgId,
          connectorId: row.connectorId,
          secretId: row.secretId,
          credentialRevision: row.credentialRevision,
        };
        if (row.revokedAt !== null)
          throw new Error(
            "Connector vault maintenance returned a revoked envelope",
          );
        const ciphertext = row.ciphertext.replace(/\s/g, "");
        if (
          row.format === "legacy-pgp" &&
          row.keyId === null &&
          row.nonce === null &&
          row.authTag === null
        )
          return {
            ...context,
            format: row.format,
            ciphertext,
            keyId: null,
            nonce: null,
            authTag: null,
          };
        if (
          row.format === "aes-256-gcm-v1" &&
          row.keyId &&
          row.nonce &&
          row.authTag
        )
          return {
            ...context,
            format: row.format,
            ciphertext,
            keyId: row.keyId,
            nonce: row.nonce,
            authTag: row.authTag,
          };
        throw new Error(
          "Connector vault maintenance returned an invalid envelope",
        );
      });
  }

  async replace(
    orgId: string,
    previous: StoredConnectorEnvelope,
    next: ConnectorSecretEnvelope,
  ): Promise<"rewrapped" | "conflict"> {
    if (orgId !== previous.orgId)
      throw new Error("Connector vault maintenance tenant mismatch");
    const { data, error } = rpcResultSchema.parse(
      await this.client.rpc("m11_rewrap_connector_secret_atomic", {
        p_organization_id: orgId,
        p_connector_id: previous.connectorId,
        p_secret_id: previous.secretId,
        p_expected_key_id: previous.keyId,
        p_expected_ciphertext: previous.ciphertext,
        p_payload: {
          keyId: next.keyId,
          ciphertext: next.ciphertext,
          nonce: next.nonce,
          authTag: next.authTag,
        },
      }),
    );
    if (error) throw new Error("Connector vault maintenance update failed");
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
      throw new Error("Connector vault maintenance update rejected");
    return rows[0]!.outcome === "updated" ? "rewrapped" : "conflict";
  }
}
