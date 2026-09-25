import { addUtcCalendarYears } from "./product-retention-policy";

export const SECURITY_UPDATE_AVAILABILITY_POLICY_VERSION =
  "m2.v2.security-update-availability.v1" as const;

export type SecurityUpdateAvailabilityIncompleteReason =
  "missing_issued_at" | "missing_support_period";
export type SecurityUpdateAvailabilityWinningRule =
  "issued_at_plus_10_calendar_years" | "support_period_end" | "equal";

export type SecurityUpdateAvailabilityResult = Readonly<{
  ruleVersion: typeof SECURITY_UPDATE_AVAILABILITY_POLICY_VERSION;
  status: "current" | "incomplete";
  issuedCandidate: string | null;
  supportCandidate: string | null;
  winningRule: SecurityUpdateAvailabilityWinningRule | null;
  computedAvailabilityUntil: string | null;
  availabilityUntil: string | null;
  nonReductionApplied: boolean;
  incompleteReasons: readonly SecurityUpdateAvailabilityIncompleteReason[];
}>;

/**
 * Computes the legal candidate and guards recalculation from shortening an
 * already-published availability date. Input parsing remains at the contract
 * boundary; this policy owns only deterministic UTC arithmetic.
 */
export function calculateSecurityUpdateAvailability(
  input: Readonly<{
    issuedAt: string | null;
    supportEndsAt: string | null;
    existingAvailabilityUntil?: string | null;
  }>,
): SecurityUpdateAvailabilityResult {
  const incompleteReasons: SecurityUpdateAvailabilityIncompleteReason[] = [];
  if (input.issuedAt === null) incompleteReasons.push("missing_issued_at");
  if (input.supportEndsAt === null) {
    incompleteReasons.push("missing_support_period");
  }

  const issuedCandidate = input.issuedAt
    ? addUtcCalendarYears(input.issuedAt, 10)
    : null;
  const supportCandidate = input.supportEndsAt;
  const computedAvailabilityUntil =
    issuedCandidate !== null && supportCandidate !== null
      ? laterInstant(issuedCandidate, supportCandidate)
      : null;
  const winningRule = winningRuleFor(issuedCandidate, supportCandidate);
  const availabilityUntil = laterInstant(
    computedAvailabilityUntil,
    input.existingAvailabilityUntil ?? null,
  );
  const nonReductionApplied =
    input.existingAvailabilityUntil !== null &&
    input.existingAvailabilityUntil !== undefined &&
    (computedAvailabilityUntil === null ||
      Date.parse(input.existingAvailabilityUntil) >
        Date.parse(computedAvailabilityUntil));

  return Object.freeze({
    ruleVersion: SECURITY_UPDATE_AVAILABILITY_POLICY_VERSION,
    status: incompleteReasons.length === 0 ? "current" : "incomplete",
    issuedCandidate,
    supportCandidate,
    winningRule,
    computedAvailabilityUntil,
    availabilityUntil,
    nonReductionApplied,
    incompleteReasons: Object.freeze(incompleteReasons),
  });
}

function winningRuleFor(
  issuedCandidate: string | null,
  supportCandidate: string | null,
): SecurityUpdateAvailabilityWinningRule | null {
  if (!issuedCandidate || !supportCandidate) return null;
  const comparison = Date.parse(issuedCandidate) - Date.parse(supportCandidate);
  return comparison > 0
    ? "issued_at_plus_10_calendar_years"
    : comparison < 0
      ? "support_period_end"
      : "equal";
}

function laterInstant(
  left: string | null,
  right: string | null,
): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
