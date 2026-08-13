export const RETENTION_RULE_VERSION =
  "m2.v1.later_of_placement_plus_10y_or_support_end" as const;

export type RetentionIncompleteReason =
  "missing_placed_on_market_at" | "missing_support_period" | "missing_release";
export type RetentionWinningRule =
  "placed_on_market_plus_10_calendar_years" | "support_period_end" | "equal";

export type ReleaseRetentionResult = Readonly<{
  releaseId: string;
  ruleVersion: typeof RETENTION_RULE_VERSION;
  status: "current" | "incomplete";
  placedOnMarketCandidate: string | null;
  supportPeriodCandidate: string | null;
  retentionUntil: string | null;
  retentionProtectionUntil: string | null;
  winningRule: RetentionWinningRule | null;
  incompleteReasons: readonly RetentionIncompleteReason[];
  legalHoldActive: boolean;
}>;

export type ProductRetentionResult = Omit<ReleaseRetentionResult, "releaseId"> &
  Readonly<{ releaseCalculations: readonly ReleaseRetentionResult[] }>;

/** Adds legal calendar years using only UTC fields, including leap-day clamping. */
export function addUtcCalendarYears(value: string, years: number): string {
  if (!Number.isInteger(years)) {
    throw new Error("calendar years must be an integer");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid UTC instant");
  const year = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const day = Math.min(
    date.getUTCDate(),
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  );
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  ).toISOString();
}

export function calculateReleaseRetention(
  input: Readonly<{
    releaseId: string;
    placedOnMarketAt: string | null;
    supportEndsAt: string | null;
    legalHoldActive?: boolean;
    retentionProtectionUntil?: string | null;
  }>,
): ReleaseRetentionResult {
  const incompleteReasons: RetentionIncompleteReason[] = [];
  if (!input.placedOnMarketAt) {
    incompleteReasons.push("missing_placed_on_market_at");
  }
  if (!input.supportEndsAt) incompleteReasons.push("missing_support_period");

  const placedOnMarketCandidate = input.placedOnMarketAt
    ? addUtcCalendarYears(input.placedOnMarketAt, 10)
    : null;
  const supportPeriodCandidate = input.supportEndsAt;
  if (incompleteReasons.length > 0) {
    return Object.freeze({
      releaseId: input.releaseId,
      ruleVersion: RETENTION_RULE_VERSION,
      status: "incomplete",
      placedOnMarketCandidate,
      supportPeriodCandidate,
      retentionUntil: null,
      retentionProtectionUntil: input.retentionProtectionUntil ?? null,
      winningRule: null,
      incompleteReasons: Object.freeze(incompleteReasons),
      legalHoldActive: input.legalHoldActive ?? false,
    });
  }

  const comparison =
    Date.parse(placedOnMarketCandidate!) - Date.parse(supportPeriodCandidate!);
  const winningRule: RetentionWinningRule =
    comparison > 0
      ? "placed_on_market_plus_10_calendar_years"
      : comparison < 0
        ? "support_period_end"
        : "equal";
  const retentionUntil =
    comparison >= 0 ? placedOnMarketCandidate! : supportPeriodCandidate!;
  return Object.freeze({
    releaseId: input.releaseId,
    ruleVersion: RETENTION_RULE_VERSION,
    status: "current",
    placedOnMarketCandidate,
    supportPeriodCandidate,
    retentionUntil,
    retentionProtectionUntil: latestInstant(
      retentionUntil,
      input.retentionProtectionUntil,
    ),
    winningRule,
    incompleteReasons: Object.freeze([]),
    legalHoldActive: input.legalHoldActive ?? false,
  });
}

/**
 * A product has no shorter period than any release. Any incomplete release
 * prevents a misleading product date and leaves the strongest known protection
 * in place for a deletion boundary to consume.
 */
export function aggregateProductRetention(
  calculations: readonly ReleaseRetentionResult[],
  existingProtectionUntil: string | null = null,
): ProductRetentionResult {
  const releaseCalculations = Object.freeze([...calculations]);
  const incomplete = releaseCalculations.filter(
    (item) => item.status === "incomplete",
  );
  if (releaseCalculations.length === 0 || incomplete.length > 0) {
    const incompleteReasons = uniqueReasons(
      releaseCalculations.length === 0
        ? ["missing_release" as const]
        : incomplete.flatMap((item) => item.incompleteReasons),
    );
    const retentionProtectionUntil = releaseCalculations.reduce(
      (latest, item) => latestInstant(latest, item.retentionProtectionUntil),
      existingProtectionUntil,
    );
    return Object.freeze({
      ruleVersion: RETENTION_RULE_VERSION,
      status: "incomplete",
      placedOnMarketCandidate: null,
      supportPeriodCandidate: null,
      retentionUntil: null,
      retentionProtectionUntil,
      winningRule: null,
      incompleteReasons,
      legalHoldActive: releaseCalculations.some((item) => item.legalHoldActive),
      releaseCalculations,
    });
  }

  const controlling = releaseCalculations.reduce((latest, item) =>
    Date.parse(item.retentionUntil!) > Date.parse(latest.retentionUntil!)
      ? item
      : latest,
  );
  return Object.freeze({
    ruleVersion: RETENTION_RULE_VERSION,
    status: "current",
    placedOnMarketCandidate: controlling.placedOnMarketCandidate,
    supportPeriodCandidate: controlling.supportPeriodCandidate,
    retentionUntil: controlling.retentionUntil,
    retentionProtectionUntil: latestInstant(
      existingProtectionUntil,
      ...releaseCalculations.map((item) => item.retentionProtectionUntil),
    ),
    winningRule: controlling.winningRule,
    incompleteReasons: Object.freeze([]),
    legalHoldActive: releaseCalculations.some((item) => item.legalHoldActive),
    releaseCalculations,
  });
}

function latestInstant(
  ...values: readonly (string | null | undefined)[]
): string | null {
  return values.reduce<string | null>((latest, candidate) => {
    if (!candidate) return latest;
    if (!latest || Date.parse(candidate) > Date.parse(latest)) return candidate;
    return latest;
  }, null);
}

function uniqueReasons(
  values: readonly RetentionIncompleteReason[],
): readonly RetentionIncompleteReason[] {
  return Object.freeze([...new Set(values)]);
}
