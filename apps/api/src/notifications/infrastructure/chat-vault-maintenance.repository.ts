import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ConnectorSecretEnvelope } from "../../connectors/application/connector-vault.port";
import type {
  ConnectorVaultKeyReferences,
  ConnectorVaultMaintenanceStore,
  StoredConnectorEnvelope,
} from "../../connectors/infrastructure/connector-vault-maintenance";

const uuid = z.string().uuid();
const envelopeSchema = z
  .object({
    format: z.literal("aes-256-gcm-v1"),
    keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
    ciphertext: z.string().min(1).max(106_672),
    nonce: z.string().min(1).max(32),
    authTag: z.string().min(1).max(32),
  })
  .strict();
const rowSchema = z
  .object({
    channel_id: uuid,
    credential_revision: z.number().int().positive(),
    credential_envelope: envelopeSchema,
  })
  .strict();
const pageSize = 100;
const maxReferencePages = 10_000;

/** Service-only chat vault maintenance. Every RPC is fenced to one organization. */
export class SupabaseChatVaultMaintenanceStore implements ConnectorVaultMaintenanceStore {
  constructor(private readonly client: SupabaseClient) {}

  async keyReferences(orgId: string): Promise<ConnectorVaultKeyReferences> {
    this.scope(orgId);
    let afterId: string | null = null;
    let references: Readonly<Record<string, number>> = {};
    for (let page = 0; page < maxReferencePages; page += 1) {
      const rows = await this.list(orgId, afterId, pageSize);
      for (const row of rows) {
        const keyId = row.keyId;
        if (!keyId) throw new Error("Chat vault maintenance envelope invalid");
        references = { ...references, [keyId]: (references[keyId] ?? 0) + 1 };
      }
      if (rows.length < pageSize)
        return {
          envelopeKeyReferences: references,
          commandKeyReferences: {},
          legacyEnvelopeCount: 0,
          hasMoreKeys: Object.keys(references).length > 100,
        };
      afterId = rows.at(-1)!.secretId;
    }
    return {
      envelopeKeyReferences: references,
      commandKeyReferences: {},
      legacyEnvelopeCount: 0,
      hasMoreKeys: true,
    };
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
      limit > pageSize ||
      (afterId !== null && !uuid.safeParse(afterId).success)
    )
      throw new Error("Invalid maintenance pagination");
    let data: unknown;
    try {
      const result = await this.client.rpc("m12_05_list_chat_envelopes", {
        p_organization_id: orgId,
        p_after_id: afterId,
        p_limit: limit,
      });
      if (result.error) throw new Error();
      data = result.data;
    } catch {
      throw new Error("Chat vault maintenance read failed");
    }
    const parsed = z.array(rowSchema).safeParse(data);
    if (!parsed.success || parsed.data.length > limit)
      throw new Error("Invalid chat vault maintenance page");
    let previous = afterId;
    for (const row of parsed.data) {
      if (previous !== null && row.channel_id <= previous)
        throw new Error("Invalid chat vault maintenance page");
      previous = row.channel_id;
    }
    return parsed.data.map((row) => ({
      orgId,
      connectorId: row.channel_id,
      secretId: row.channel_id,
      credentialRevision: row.credential_revision,
      ...row.credential_envelope,
    }));
  }

  async replace(
    orgId: string,
    previous: StoredConnectorEnvelope,
    next: ConnectorSecretEnvelope,
  ): Promise<"rewrapped" | "conflict"> {
    this.scope(orgId);
    if (previous.orgId !== orgId)
      throw new Error("Chat vault maintenance tenant mismatch");
    if (
      !uuid.safeParse(previous.connectorId).success ||
      previous.connectorId !== previous.secretId ||
      previous.format !== "aes-256-gcm-v1"
    )
      throw new Error("Chat vault maintenance identity mismatch");
    const expected = envelopeSchema.safeParse({
      format: previous.format,
      keyId: previous.keyId,
      ciphertext: previous.ciphertext,
      nonce: previous.nonce,
      authTag: previous.authTag,
    });
    const replacement = envelopeSchema.safeParse(next);
    if (!expected.success || !replacement.success)
      throw new Error("Chat vault maintenance envelope invalid");
    try {
      const result = await this.client.rpc(
        "m12_05_rewrap_chat_envelope_atomic",
        {
          p_organization_id: orgId,
          p_channel_id: previous.connectorId,
          p_expected_credential_revision: previous.credentialRevision,
          p_expected_envelope: expected.data,
          p_new_envelope: replacement.data,
        },
      );
      if (result.error || typeof result.data !== "boolean") throw new Error();
      return result.data ? "rewrapped" : "conflict";
    } catch {
      throw new Error("Chat vault maintenance update failed");
    }
  }

  private scope(orgId: string): void {
    if (!uuid.safeParse(orgId).success)
      throw new Error("Invalid maintenance scope");
  }
}
