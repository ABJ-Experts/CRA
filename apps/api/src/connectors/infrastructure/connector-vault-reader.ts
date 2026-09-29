import {
  ConnectorVaultUnavailableError,
  type ConnectorCredentialReaderPort,
  type ConnectorSecretEnvelope,
  type ConnectorVaultContext,
  type ConnectorVaultPort,
} from "../application/connector-vault.port";
import { decryptLegacyConnectorPgp } from "./connector-vault-legacy";

/** Temporary PGP bridge shares the maintenance integrity checks; it never calls plaintext RPCs. */
export class ConnectorCredentialReader implements ConnectorCredentialReaderPort {
  constructor(
    private readonly vault: ConnectorVaultPort,
    private readonly legacyPassphrase?: string,
    private readonly legacy: Readonly<{
      binary?: string;
      decryptLegacy?: typeof decryptLegacyConnectorPgp;
    }> = {},
  ) {}

  async read(
    context: ConnectorVaultContext,
    credential: Readonly<{
      envelope: ConnectorSecretEnvelope | null;
      legacy: boolean;
      legacyCiphertextBase64?: string;
    }>,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      if (signal?.aborted) throw new ConnectorVaultUnavailableError();
      if (!credential.legacy && credential.envelope)
        return this.vault.decrypt(context, credential.envelope);
      if (
        credential.legacy &&
        credential.envelope === null &&
        credential.legacyCiphertextBase64 &&
        this.legacyPassphrase
      ) {
        return await (this.legacy.decryptLegacy ?? decryptLegacyConnectorPgp)(
          credential.legacyCiphertextBase64,
          this.legacyPassphrase,
          { binary: this.legacy.binary, signal },
        );
      }
      throw new ConnectorVaultUnavailableError();
    } catch {
      throw new ConnectorVaultUnavailableError();
    }
  }
}
