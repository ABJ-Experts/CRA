import {
  preflightUpgrade,
  type UpgradePreflightFacts,
} from "../domain/upgrade-preflight";
/** Fresh native inspection independently proves the remaining resource threshold.
 * Only that admitted import allocation changes; all source/authority/trust facts stay bound. */
export function matchesApprovedImportReview(
  approved: UpgradePreflightFacts,
  fresh: UpgradePreflightFacts,
  fingerprint: string,
  now: Date,
): boolean {
  if (!preflightUpgrade(fresh, now).allowed) return false;
  return (
    preflightUpgrade(
      {
        ...fresh,
        freeBytes: approved.freeBytes,
        requiredBytes: approved.requiredBytes,
      },
      now,
    ).fingerprint === fingerprint
  );
}
