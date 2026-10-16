import { z } from "zod";
import {
  ConnectorVaultUnavailableError,
  type ConnectorSecretEnvelope,
  type ConnectorVaultPort,
} from "../application/connector-vault.port";
import type {
  WebhookVaultContext,
  WebhookVaultPort,
} from "../application/webhook-vault.port";
export type { WebhookVaultContext } from "../application/webhook-vault.port";

const contextSchema = z
  .object({
    orgId: z.string().uuid(),
    endpointId: z.string().uuid(),
    signingKeyId: z.string().uuid(),
    secretRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

/** Reuses the existing envelope format while separating webhook identities. */
export class WebhookVault implements WebhookVaultPort {
  constructor(private readonly vault: ConnectorVaultPort) {}

  available(): boolean {
    return this.vault.available();
  }
  keyIds(): readonly string[] {
    return this.vault.keyIds();
  }

  encrypt(
    context: WebhookVaultContext,
    secret: string,
  ): ConnectorSecretEnvelope {
    try {
      const bytes = Buffer.from(secret, "base64");
      if (bytes.length !== 32 || bytes.toString("base64") !== secret)
        throw new ConnectorVaultUnavailableError();
      return this.vault.encrypt(this.context(context), secret);
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }

  decrypt(
    context: WebhookVaultContext,
    envelope: ConnectorSecretEnvelope,
  ): string {
    return this.vault.decrypt(this.context(context), envelope);
  }

  fingerprint(
    orgId: string,
    endpointId: string,
    canonicalRequest: string,
    keyId?: string,
  ) {
    try {
      z.string().uuid().parse(orgId);
      z.string().uuid().parse(endpointId);
      return this.vault.fingerprint(
        orgId,
        `webhook:${endpointId}`,
        `webhook-command-v1\n${canonicalRequest}`,
        keyId,
      );
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }

  private context(value: WebhookVaultContext) {
    const parsed = contextSchema.safeParse(value);
    if (!parsed.success) throw new ConnectorVaultUnavailableError();
    return {
      orgId: parsed.data.orgId,
      connectorId: `webhook:${parsed.data.endpointId}`,
      secretId: parsed.data.signingKeyId,
      credentialRevision: parsed.data.secretRevision,
    };
  }
}
