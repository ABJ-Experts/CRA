import type { SiemCredential } from "@repo/contracts/audit/types";
import type {
  ConnectorSecretEnvelope,
  ConnectorRequestFingerprint,
} from "../../../connectors/application/connector-vault.port";
export type SiemVaultContext = Readonly<{
  orgId: string;
  destinationId: string;
  credentialId: string;
  credentialRevision: number;
}>;
export interface SiemVaultPort {
  available(): boolean;
  keyIds(): readonly string[];
  encrypt(
    context: SiemVaultContext,
    credential: SiemCredential,
  ): ConnectorSecretEnvelope;
  decrypt(
    context: SiemVaultContext,
    envelope: ConnectorSecretEnvelope,
  ): SiemCredential;
  fingerprint(
    orgId: string,
    destinationId: string,
    canonicalRequest: string,
    keyId?: string,
  ): ConnectorRequestFingerprint;
}

export class SiemCredentialInvalidError extends Error {
  constructor() {
    super("Supply a valid current client certificate and matching private key");
    this.name = "SiemCredentialInvalidError";
  }
}
