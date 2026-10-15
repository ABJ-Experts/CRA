import { posix } from "node:path";

export interface RecoveryProfile {
  readonly image: string;
  readonly postgresVersion: string;
  readonly networkInternal: boolean;
  readonly maxExpandedBytes: number;
  readonly maxEntries: number;
  readonly deadlineMs: number;
}
export { REQUIRED_RECOVERY_CHECKS as RECOVERY_REQUIRED_CHECKS } from "./isolated-backup-verifier";
import { REQUIRED_RECOVERY_CHECKS } from "./isolated-backup-verifier";

/** Mounted profiles are validated too: a mount is configuration, never authority. */
export function assertRecoveryProfile(profile: RecoveryProfile): void {
  if (
    !/^(?:public\.ecr\.aws\/)?supabase\/postgres:17\.6\.\d+\.\d+(?:@sha256:[a-f0-9]{64})?$/.test(
      profile.image,
    ) ||
    profile.postgresVersion !== "17.6" ||
    profile.networkInternal !== true ||
    !Number.isSafeInteger(profile.maxExpandedBytes) ||
    profile.maxExpandedBytes <= 0 ||
    !Number.isSafeInteger(profile.maxEntries) ||
    profile.maxEntries <= 0 ||
    !Number.isSafeInteger(profile.deadlineMs) ||
    profile.deadlineMs <= 0 ||
    profile.deadlineMs > 4 * 60 * 60 * 1000
  )
    throw new Error("recovery_profile_unsafe");
}

export function assertFreshTarget(input: {
  readonly name: string;
  readonly existingNames: readonly string[];
  readonly sourceNames: readonly string[];
}): void {
  if (
    !/^cra-backup-restore-[a-f0-9-]{8,64}$/.test(input.name) ||
    input.existingNames.includes(input.name) ||
    input.sourceNames.includes(input.name)
  )
    throw new Error("recovery_target_unsafe");
}

/** Closed tar vocabulary; no links, devices, sparse/PAX overrides or path rewriting. */
export function assertRecoveryArchiveEntry(
  entry: {
    readonly path: string;
    readonly type: string;
    readonly size: number;
  },
  seen: ReadonlySet<string>,
  expandedBytes: number,
  limit: number,
): string {
  const name = entry.path.replace(/^\.\//, "").replace(/\/$/, "");
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    [...name].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    name.split("/").some((part) => !part || part === "." || part === "..") ||
    posix.normalize(name) !== name ||
    !["file", "directory"].includes(entry.type) ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    !Number.isSafeInteger(expandedBytes) ||
    expandedBytes < 0 ||
    expandedBytes > limit ||
    entry.size > limit - expandedBytes ||
    seen.has(name)
  )
    throw new Error("recovery_archive_unsafe");
  return name;
}

export function assertVerificationCoverage(
  checks: readonly { readonly code: string; readonly status: string }[],
): void {
  if (
    REQUIRED_RECOVERY_CHECKS.some(
      (code) =>
        checks.filter(
          (check) => check.code === code && check.status === "passed",
        ).length !== 1,
    ) ||
    checks.some((check) => check.status !== "passed")
  )
    throw new Error("recovery_checks_incomplete");
}
