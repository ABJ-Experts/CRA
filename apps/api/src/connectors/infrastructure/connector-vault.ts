import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

import {
  ConnectorVaultUnavailableError,
  type ConnectorRequestFingerprint,
  type ConnectorSecretEnvelope,
  type ConnectorVaultContext,
  type ConnectorVaultPort,
} from "../application/connector-vault.port";

const keyIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const configurationSchema = z
  .object({
    activeKeyId: keyIdSchema,
    keys: z
      .record(keyIdSchema, z.string())
      .refine(
        (keys) =>
          Object.keys(keys).length > 0 && Object.keys(keys).length <= 64,
      ),
  })
  .strict();
const contextSchema = z
  .object({
    orgId: z.string().min(1).max(200),
    connectorId: z.string().min(1).max(200),
    secretId: z.string().min(1).max(200),
    credentialRevision: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const envelopeSchema = z
  .object({
    format: z.literal("aes-256-gcm-v1"),
    keyId: keyIdSchema,
    ciphertext: z.string().min(1).max(106_672),
    nonce: z.string(),
    authTag: z.string(),
  })
  .strict();

const decode = (value: string, length?: number): Buffer => {
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.toString("base64") !== value ||
    (length !== undefined && bytes.length !== length)
  )
    throw new ConnectorVaultUnavailableError();
  return bytes;
};

/** External key material is copied once; malformed configuration disables only the vault. */
export class AesGcmConnectorVault implements ConnectorVaultPort {
  private readonly keys: ReadonlyMap<string, Buffer>;
  private readonly activeKeyId: string | undefined;

  constructor(rawConfiguration?: string) {
    try {
      const configuration = configurationSchema.parse(
        JSON.parse(rawConfiguration ?? ""),
      );
      const keys = new Map(
        Object.entries(configuration.keys).map(
          ([id, value]) => [id, decode(value, 32)] as const,
        ),
      );
      if (!keys.has(configuration.activeKeyId))
        throw new ConnectorVaultUnavailableError();
      this.keys = keys;
      this.activeKeyId = configuration.activeKeyId;
    } catch {
      this.keys = new Map();
      this.activeKeyId = undefined;
    }
  }

  available(): boolean {
    return this.activeKeyId !== undefined;
  }
  keyIds(): readonly string[] {
    return Object.freeze([...this.keys.keys()]);
  }

  encrypt(
    context: ConnectorVaultContext,
    secret: string,
  ): ConnectorSecretEnvelope {
    try {
      contextSchema.parse(context);
      z.string().min(1).max(20_000).parse(secret);
      const keyId = this.activeKeyId;
      const key = this.key(keyId);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce, {
        authTagLength: 16,
      });
      cipher.setAAD(this.aad(context, keyId!));
      const plaintext = Buffer.from(secret, "utf8");
      try {
        const ciphertext = Buffer.concat([
          cipher.update(plaintext),
          cipher.final(),
        ]);
        return Object.freeze({
          format: "aes-256-gcm-v1",
          keyId: keyId!,
          ciphertext: ciphertext.toString("base64"),
          nonce: nonce.toString("base64"),
          authTag: cipher.getAuthTag().toString("base64"),
        });
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }

  decrypt(
    context: ConnectorVaultContext,
    envelope: ConnectorSecretEnvelope,
  ): string {
    try {
      contextSchema.parse(context);
      envelopeSchema.parse(envelope);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key(envelope.keyId),
        decode(envelope.nonce, 12),
        { authTagLength: 16 },
      );
      decipher.setAAD(this.aad(context, envelope.keyId));
      decipher.setAuthTag(decode(envelope.authTag, 16));
      const plaintext = Buffer.concat([
        decipher.update(decode(envelope.ciphertext)),
        decipher.final(),
      ]);
      try {
        const secret = plaintext.toString("utf8");
        if (
          Buffer.from(secret, "utf8").compare(plaintext) !== 0 ||
          secret.length === 0 ||
          secret.length > 20_000
        )
          throw new ConnectorVaultUnavailableError();
        return secret;
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }

  fingerprint(
    orgId: string,
    connectorId: string,
    canonicalRequest: string,
    retainedKeyId?: string,
  ): ConnectorRequestFingerprint {
    try {
      z.string().min(1).max(200).parse(orgId);
      z.string().min(1).max(200).parse(connectorId);
      z.string().max(100_000).parse(canonicalRequest);
      const keyId = retainedKeyId ?? this.activeKeyId;
      const key = Buffer.from(
        hkdfSync(
          "sha256",
          this.key(keyId),
          "cra-connector-vault-v1",
          "command-fingerprint",
          32,
        ),
      );
      try {
        const digest = createHmac("sha256", key)
          .update(
            JSON.stringify([
              "command-fingerprint-v1",
              orgId,
              connectorId,
              canonicalRequest,
            ]),
          )
          .digest("hex");
        return Object.freeze({ keyId: keyId!, digest });
      } finally {
        key.fill(0);
      }
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }

  private key(keyId?: string): Buffer {
    const key = keyId === undefined ? undefined : this.keys.get(keyId);
    if (!key) throw new ConnectorVaultUnavailableError();
    return key;
  }

  private aad(context: ConnectorVaultContext, keyId: string): Buffer {
    return Buffer.from(
      JSON.stringify([
        "cra-connector-secret",
        "aes-256-gcm-v1",
        keyId,
        context.orgId,
        context.connectorId,
        context.secretId,
        context.credentialRevision,
      ]),
      "utf8",
    );
  }
}
