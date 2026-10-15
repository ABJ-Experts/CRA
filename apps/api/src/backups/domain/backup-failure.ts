import { backupFailureCodeSchema } from "@repo/contracts/backups/schemas";
import type { BackupFailureCode } from "@repo/contracts/backups/types";
const aliases: Readonly<Record<string, BackupFailureCode>> = Object.freeze({
  unknown_mount_alias: "configuration_invalid",
  unsafe_pause_limit: "configuration_invalid",
  repository_binding: "repository_discontinuity",
  unsafe_mount_configuration: "configuration_invalid",
  unsafe_key_mount: "key_unavailable",
  insufficient_staging: "insufficient_capacity",
  insufficient_repository: "repository_full",
  unsafe_plaintext_staging: "staging_unsafe",
  native_output_limit: "insufficient_capacity",
  native_tool_failed: "source_unavailable",
  native_tool_unavailable: "incompatible_runtime",
  write_fence_expired: "fence_expired",
  write_fence_unavailable: "write_drain_timeout",
  object_integrity: "object_corrupt",
  unsafe_object_identity: "object_corrupt",
  unsupported_tablespace: "configuration_invalid",
  ciphertext_integrity: "ciphertext_invalid",
  plaintext_integrity: "ciphertext_invalid",
  decryption_failed: "ciphertext_invalid",
  encryption_failed: "key_unavailable",
  certificate_integrity: "manifest_invalid",
  capture_incomplete: "source_unavailable",
});
export function backupFailure(error: unknown): BackupFailureCode {
  const message = error instanceof Error ? error.message : "internal_failure";
  const parsed = backupFailureCodeSchema.safeParse(message);
  return parsed.success
    ? parsed.data
    : (aliases[message] ?? "internal_failure");
}
