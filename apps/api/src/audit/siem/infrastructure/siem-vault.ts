import { X509Certificate, createPrivateKey } from "node:crypto";
import { z } from "zod";
import { siemCredentialSchema } from "@repo/contracts/audit/schemas";
import type { SiemCredential } from "@repo/contracts/audit/types";
import {
  ConnectorVaultUnavailableError,
  type ConnectorVaultPort,
  type ConnectorSecretEnvelope,
} from "../../../connectors/application/connector-vault.port";
import { SiemCredentialInvalidError } from "../application/siem-vault.port";
import type {
  SiemVaultContext,
  SiemVaultPort,
} from "../application/siem-vault.port";
const contextSchema = z
  .object({
    orgId: z.uuid(),
    destinationId: z.uuid(),
    credentialId: z.uuid(),
    credentialRevision: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
/** Distinct AAD and HMAC namespace; never expose plaintext through public DTOs. */
export class SiemVault implements SiemVaultPort {
  constructor(private readonly vault: ConnectorVaultPort) {}
  available() {
    return this.vault.available();
  }
  keyIds() {
    return this.vault.keyIds();
  }
  encrypt(
    context: SiemVaultContext,
    credential: SiemCredential,
  ): ConnectorSecretEnvelope {
    let validated: SiemCredential;
    try {
      validated = validateCredential(credential);
    } catch {
      throw new SiemCredentialInvalidError();
    }
    try {
      return this.vault.encrypt(
        this.context(context),
        JSON.stringify(validated),
      );
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }
  decrypt(
    context: SiemVaultContext,
    envelope: ConnectorSecretEnvelope,
  ): SiemCredential {
    try {
      return validateCredential(
        JSON.parse(this.vault.decrypt(this.context(context), envelope)),
      );
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }
  fingerprint(
    orgId: string,
    destinationId: string,
    canonicalRequest: string,
    keyId?: string,
  ) {
    try {
      z.uuid().parse(orgId);
      z.uuid().parse(destinationId);
      return this.vault.fingerprint(
        orgId,
        `siem:${destinationId}`,
        `siem-command-v1\n${canonicalRequest}`,
        keyId,
      );
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }
  private context(value: SiemVaultContext) {
    const c = contextSchema.parse(value);
    return {
      orgId: c.orgId,
      connectorId: `siem:${c.destinationId}`,
      secretId: c.credentialId,
      credentialRevision: c.credentialRevision,
    };
  }
}

function validateCredential(value: unknown): SiemCredential {
  const credential = siemCredentialSchema.parse(value);
  if (JSON.stringify(credential).length > 20_000)
    throw new SiemCredentialInvalidError();
  if (credential.mode === "mtls") {
    const certificate = new X509Certificate(credential.certificate);
    const now = Date.now();
    if (
      Date.parse(certificate.validFrom) > now ||
      Date.parse(certificate.validTo) <= now ||
      !certificate.checkPrivateKey(createPrivateKey(credential.privateKey))
    )
      throw new ConnectorVaultUnavailableError();
    if (credential.ca) {
      const matches = credential.ca.match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      );
      if (!matches?.length) throw new ConnectorVaultUnavailableError();
      for (const pem of matches) {
        const ca = new X509Certificate(pem);
        if (!ca.ca || Date.parse(ca.validTo) <= now)
          throw new ConnectorVaultUnavailableError();
      }
    }
  }
  return credential;
}
