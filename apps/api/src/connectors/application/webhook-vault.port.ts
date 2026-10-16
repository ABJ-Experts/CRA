import type { ConnectorSecretEnvelope } from "./connector-vault.port";

export type WebhookVaultContext = Readonly<{
  orgId: string;
  endpointId: string;
  signingKeyId: string;
  secretRevision: number;
}>;
export interface WebhookVaultPort {
  available(): boolean;
  keyIds(): readonly string[];
  encrypt(
    context: WebhookVaultContext,
    secret: string,
  ): ConnectorSecretEnvelope;
  decrypt(
    context: WebhookVaultContext,
    envelope: ConnectorSecretEnvelope,
  ): string;
  fingerprint(
    orgId: string,
    endpointId: string,
    canonicalRequest: string,
    retainedKeyId?: string,
  ): Readonly<{ keyId: string; digest: string }>;
}
