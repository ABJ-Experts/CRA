import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { AesGcmConnectorVault } from "./connectors/infrastructure/connector-vault";
import { decryptLegacyConnectorPgp } from "./connectors/infrastructure/connector-vault-legacy";
import { maintainConnectorVault } from "./connectors/infrastructure/connector-vault-maintenance";
import { SupabaseConnectorVaultMaintenanceStore } from "./connectors/infrastructure/connector-vault-maintenance.repository";

export function parseConnectorVaultMaintenanceArguments(
  args: readonly string[],
): Readonly<{ orgId: string; batchSize: number; execute: boolean }> {
  if (
    args.some(
      (value) =>
        !["--org", "--batch-size", "--execute"].includes(value) &&
        (value.startsWith("--") || value.includes("=")),
    )
  )
    throw new Error("Invalid maintenance arguments");
  let orgId: string | undefined;
  let batchSize = 50;
  let execute = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (seen.has(arg)) throw new Error("Invalid maintenance arguments");
    seen.add(arg);
    if (arg === "--execute") execute = true;
    else if (arg === "--org") orgId = z.string().uuid().parse(args[++index]);
    else if (arg === "--batch-size")
      batchSize = z.coerce.number().int().min(1).max(100).parse(args[++index]);
    else throw new Error("Invalid maintenance arguments");
  }
  return { orgId: z.string().uuid().parse(orgId), batchSize, execute };
}

export async function runConnectorVaultMaintenance(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const options = parseConnectorVaultMaintenanceArguments(args);
  const vault = new AesGcmConnectorVault(environment.CONNECTOR_VAULT_KEYRING);
  if (!vault.available())
    throw new Error("Connector vault keyring is unavailable");
  const url = z.string().url().parse(environment.SUPABASE_URL);
  const key = z.string().min(1).parse(environment.SUPABASE_SERVICE_ROLE_KEY);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const legacyKey = environment.CONNECTOR_SECRET_ENCRYPTION_KEY;
    const result = await maintainConnectorVault(
      new SupabaseConnectorVaultMaintenanceStore(client),
      vault,
      { ...options, signal: abort.signal },
      legacyKey
        ? (ciphertext) =>
            decryptLegacyConnectorPgp(ciphertext, legacyKey, {
              binary: environment.CONNECTOR_VAULT_GPG_BINARY,
              signal: abort.signal,
            })
        : undefined,
    );
    process.stdout.write(
      `${JSON.stringify({ ...result, keyReferenceScope: "active_ciphertext_before_rotation", retentionWarning: "Retain keys referenced by command fingerprints and backups; this report does not authorize key retirement." })}\n`,
    );
    if (
      result.failed ||
      result.conflicts ||
      result.missingKeyIds.length ||
      result.retainedKeyReferences.hasMoreKeys
    )
      process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

if (require.main === module) {
  void runConnectorVaultMaintenance(process.argv.slice(2), process.env).catch(
    () => {
      process.stderr.write(
        "Connector vault maintenance failed safely. Check configuration and retained recovery keys.\n",
      );
      process.exitCode = 1;
    },
  );
}
