import { z } from "zod";
import { BackupExecutionError } from "../../application/backup-execution.port";
import type { RecoveryExternalKeyProbe } from "../restore/native-docker-recovery.adapter";

/** Only aliases already mounted at the pinned PGsodium root-key target are registered here. */
export function createRecoveryExternalKeyProbe(
  rootKeyAliases: readonly string[],
): RecoveryExternalKeyProbe {
  const parsed = z
    .array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/))
    .max(100)
    .safeParse(rootKeyAliases);
  if (!parsed.success)
    throw new BackupExecutionError("recovery_key_configuration");
  const allowed = new Set(parsed.data);
  return async (alias, target, signal) => {
    if (!allowed.has(alias)) return false;
    try {
      // Recovery has already authenticated this mounted key's encrypted file-hash canary.
      // Empty Vault has no encrypted rows to decrypt. Otherwise every row must authenticate;
      // no secret, name, identifier or decrypted bytes ever leave PostgreSQL.
      const result = await target.sql(
        "select (case when count(*)=0 then true else coalesce(bool_and(octet_length(decrypted_secret)>=0),false) end)::text from vault.decrypted_secrets",
        AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      );
      return result === "true";
    } catch {
      return false;
    }
  };
}
