import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseConnectorVaultMaintenanceArguments } from "./connector-vault-maintenance";
import { AesGcmConnectorVault } from "./connectors/infrastructure/connector-vault";
import { maintainConnectorVault } from "./connectors/infrastructure/connector-vault-maintenance";
import { SupabaseChatVaultMaintenanceStore } from "./notifications/infrastructure/chat-vault-maintenance.repository";

/** Organization-scoped recovery check and optional chat envelope rotation. */
export async function runChatVaultMaintenance(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const options = parseConnectorVaultMaintenanceArguments(args);
  const vault = new AesGcmConnectorVault(environment.CONNECTOR_VAULT_KEYRING);
  if (!vault.available()) throw new Error("Chat vault keyring is unavailable");
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
    const result = await maintainConnectorVault(
      new SupabaseChatVaultMaintenanceStore(client),
      vault,
      { ...options, signal: abort.signal },
    );
    process.stdout.write(
      `${JSON.stringify({ ...result, keyReferenceScope: "active_ciphertext_before_rotation", retentionWarning: "Retain keys referenced by backups; this report does not authorize key retirement." })}\n`,
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

export function failChatVaultMaintenance(): void {
  process.stderr.write(
    "Chat vault maintenance failed safely. Check configuration and retained recovery keys.\n",
  );
  process.exitCode = 1;
}

if (require.main === module) {
  void runChatVaultMaintenance(process.argv.slice(2), process.env).catch(
    failChatVaultMaintenance,
  );
}
