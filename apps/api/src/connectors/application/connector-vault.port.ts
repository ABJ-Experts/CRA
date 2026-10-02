export type ConnectorVaultContext = Readonly<{
  orgId: string;
  connectorId: string;
  secretId: string;
  credentialRevision: number;
}>;

export type ConnectorSecretEnvelope = Readonly<{
  format: "aes-256-gcm-v1";
  keyId: string;
  ciphertext: string;
  nonce: string;
  authTag: string;
}>;

export type ConnectorRequestFingerprint = Readonly<{
  keyId: string;
  digest: string;
}>;

/** Internal storage boundary. Neither keys nor decrypted values are wire DTOs. */
export interface ConnectorVaultPort {
  available(): boolean;
  keyIds(): readonly string[];
  encrypt(
    context: ConnectorVaultContext,
    secret: string,
  ): ConnectorSecretEnvelope;
  decrypt(
    context: ConnectorVaultContext,
    envelope: ConnectorSecretEnvelope,
  ): string;
  fingerprint(
    orgId: string,
    connectorId: string,
    canonicalRequest: string,
    keyId?: string,
  ): ConnectorRequestFingerprint;
}

export interface ConnectorCredentialReaderPort {
  read(
    context: ConnectorVaultContext,
    credential: Readonly<{
      envelope: ConnectorSecretEnvelope | null;
      legacy: boolean;
      legacyCiphertextBase64?: string;
    }>,
    signal?: AbortSignal,
  ): Promise<string>;
}

export class ConnectorVaultUnavailableError extends Error {
  constructor() {
    super(
      "Connector credentials are temporarily unavailable. Contact your administrator.",
    );
    this.name = "ConnectorVaultUnavailableError";
  }
}
