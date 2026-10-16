import type {
  ConnectorSecretEnvelope,
  ConnectorVaultContext,
  ConnectorVaultPort,
} from "../application/connector-vault.port";

export type StoredConnectorEnvelope = ConnectorVaultContext &
  (
    | ConnectorSecretEnvelope
    | Readonly<{
        format: "legacy-pgp";
        keyId: null;
        ciphertext: string;
        nonce: null;
        authTag: null;
      }>
  );

export type ConnectorVaultKeyReferences = Readonly<{
  envelopeKeyReferences: Readonly<Record<string, number>>;
  commandKeyReferences: Readonly<Record<string, number>>;
  legacyEnvelopeCount: number;
  hasMoreKeys: boolean;
}>;

/** Maintenance-only boundary. No API or browser route exposes envelope bytes. */
export interface ConnectorVaultMaintenanceStore {
  keyReferences: (orgId: string) => Promise<ConnectorVaultKeyReferences>;
  list: (
    orgId: string,
    afterId: string | null,
    limit: number,
  ) => Promise<readonly StoredConnectorEnvelope[]>;
  replace: (
    orgId: string,
    previous: StoredConnectorEnvelope,
    next: ConnectorSecretEnvelope,
  ) => Promise<"rewrapped" | "conflict">;
}

export async function maintainConnectorVault(
  store: ConnectorVaultMaintenanceStore,
  vault: ConnectorVaultPort,
  options: Readonly<{
    orgId: string;
    batchSize?: number;
    execute?: boolean;
    signal?: AbortSignal;
  }>,
  decryptLegacy?: (ciphertext: string) => Promise<string>,
): Promise<
  Readonly<{
    inspected: number;
    rewrapped: number;
    conflicts: number;
    alreadyCurrent: number;
    failed: number;
    dryRun: boolean;
    keyReferences: Readonly<Record<string, number>>;
    retainedKeyReferences: ConnectorVaultKeyReferences;
    missingKeyIds: readonly string[];
  }>
> {
  const batchSize = options.batchSize ?? 50;
  if (
    !options.orgId ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100
  )
    throw new Error("Invalid maintenance options");
  const dryRun = options.execute !== true;
  const retainedKeyReferences = await store.keyReferences(options.orgId);
  const missingKeyIds = [
    ...new Set([
      ...Object.keys(retainedKeyReferences.envelopeKeyReferences),
      ...Object.keys(retainedKeyReferences.commandKeyReferences),
    ]),
  ]
    .filter((id) => !vault.keyIds().includes(id))
    .sort();
  if (
    !dryRun &&
    (retainedKeyReferences.hasMoreKeys ||
      missingKeyIds.length ||
      (retainedKeyReferences.legacyEnvelopeCount > 0 && !decryptLegacy))
  )
    throw new Error("Maintenance requires all retained recovery keys");
  let inspected = 0,
    rewrapped = 0,
    conflicts = 0,
    alreadyCurrent = 0,
    failed = 0;
  let afterId: string | null = null;
  let keyReferences: Readonly<Record<string, number>> = {};
  for (;;) {
    if (options.signal?.aborted) throw new Error("Maintenance interrupted");
    const rows = await store.list(options.orgId, afterId, batchSize);
    if (
      rows.length > batchSize ||
      rows.some(
        (row) => row.orgId !== options.orgId || row.secretId === afterId,
      )
    )
      throw new Error("Invalid maintenance page");
    for (const row of rows) {
      if (options.signal?.aborted) throw new Error("Maintenance interrupted");
      inspected += 1;
      const reference = row.keyId ?? "legacy-pgp";
      keyReferences = {
        ...keyReferences,
        [reference]:
          (Object.hasOwn(keyReferences, reference)
            ? keyReferences[reference]!
            : 0) + 1,
      };
      try {
        const context: ConnectorVaultContext = {
          orgId: options.orgId,
          connectorId: row.connectorId,
          secretId: row.secretId,
          credentialRevision: row.credentialRevision,
        };
        const secret =
          row.format === "legacy-pgp"
            ? await requiredLegacyReader(decryptLegacy)(row.ciphertext)
            : vault.decrypt(context, {
                format: row.format,
                keyId: row.keyId,
                ciphertext: row.ciphertext,
                nonce: row.nonce,
                authTag: row.authTag,
              });
        const envelope = vault.encrypt(context, secret);
        if (envelope.keyId === row.keyId) {
          alreadyCurrent += 1;
          continue;
        }
        if (!dryRun) {
          const outcome = await store.replace(options.orgId, row, envelope);
          if (outcome === "rewrapped") rewrapped += 1;
          else conflicts += 1;
        }
      } catch {
        failed += 1;
      }
    }
    if (rows.length < batchSize) break;
    afterId = rows.at(-1)!.secretId;
  }
  return Object.freeze({
    inspected,
    rewrapped,
    conflicts,
    alreadyCurrent,
    failed,
    dryRun,
    keyReferences: Object.freeze(keyReferences),
    retainedKeyReferences,
    missingKeyIds: Object.freeze(missingKeyIds),
  });
}

function requiredLegacyReader(
  reader?: (ciphertext: string) => Promise<string>,
): (ciphertext: string) => Promise<string> {
  if (!reader) throw new Error("Legacy recovery unavailable");
  return reader;
}
