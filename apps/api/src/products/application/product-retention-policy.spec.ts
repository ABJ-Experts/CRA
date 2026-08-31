import {
  RETENTION_RULE_VERSION,
  addUtcCalendarYears,
  aggregateProductRetention,
  calculateReleaseRetention,
} from "./product-retention-policy";

describe("product retention policy", () => {
  const placedOnMarketAt = "2026-08-13T10:15:30.000Z";

  it("uses the approved versioned later-of rule", () => {
    expect(RETENTION_RULE_VERSION).toBe(
      "m2.v1.later_of_placement_plus_10y_or_support_end",
    );
    expect(
      calculateReleaseRetention({
        releaseId: "release-1",
        placedOnMarketAt,
        supportEndsAt: "2034-08-13T10:15:30.000Z",
      }),
    ).toEqual({
      releaseId: "release-1",
      ruleVersion: RETENTION_RULE_VERSION,
      status: "current",
      placedOnMarketCandidate: "2036-08-13T10:15:30.000Z",
      supportPeriodCandidate: "2034-08-13T10:15:30.000Z",
      retentionUntil: "2036-08-13T10:15:30.000Z",
      retentionProtectionUntil: "2036-08-13T10:15:30.000Z",
      winningRule: "placed_on_market_plus_10_calendar_years",
      incompleteReasons: [],
      legalHoldActive: false,
    });
  });

  it("uses UTC calendar arithmetic and clamps a leap-day anniversary", () => {
    expect(addUtcCalendarYears("2024-02-29T23:30:00.000Z", 10)).toBe(
      "2034-02-28T23:30:00.000Z",
    );
  });

  it("does not use browser-local time when calculating a later support end", () => {
    expect(
      calculateReleaseRetention({
        releaseId: "release-1",
        placedOnMarketAt: "2026-12-31T23:30:00.000Z",
        supportEndsAt: "2037-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      status: "current",
      retentionUntil: "2037-01-01T00:00:00.000Z",
    });
  });

  it("reports every missing fact instead of calculating an unsafe retention end", () => {
    expect(
      calculateReleaseRetention({
        releaseId: "release-1",
        placedOnMarketAt: null,
        supportEndsAt: null,
      }),
    ).toEqual({
      releaseId: "release-1",
      ruleVersion: RETENTION_RULE_VERSION,
      status: "incomplete",
      placedOnMarketCandidate: null,
      supportPeriodCandidate: null,
      retentionUntil: null,
      retentionProtectionUntil: null,
      winningRule: null,
      incompleteReasons: [
        "missing_placed_on_market_at",
        "missing_support_period",
      ],
      legalHoldActive: false,
    });
  });

  it("aggregates every complete release at the latest retention end", () => {
    expect(
      aggregateProductRetention([
        calculateReleaseRetention({
          releaseId: "release-1",
          placedOnMarketAt,
          supportEndsAt: "2030-08-13T10:15:30.000Z",
        }),
        calculateReleaseRetention({
          releaseId: "release-2",
          placedOnMarketAt: "2027-08-13T10:15:30.000Z",
          supportEndsAt: "2040-08-13T10:15:30.000Z",
        }),
      ]),
    ).toEqual({
      ruleVersion: RETENTION_RULE_VERSION,
      status: "current",
      placedOnMarketCandidate: "2037-08-13T10:15:30.000Z",
      supportPeriodCandidate: "2040-08-13T10:15:30.000Z",
      retentionUntil: "2040-08-13T10:15:30.000Z",
      retentionProtectionUntil: "2040-08-13T10:15:30.000Z",
      winningRule: "support_period_end",
      incompleteReasons: [],
      legalHoldActive: false,
      releaseCalculations: [
        {
          releaseId: "release-1",
          ruleVersion: RETENTION_RULE_VERSION,
          status: "current",
          placedOnMarketCandidate: "2036-08-13T10:15:30.000Z",
          supportPeriodCandidate: "2030-08-13T10:15:30.000Z",
          retentionUntil: "2036-08-13T10:15:30.000Z",
          retentionProtectionUntil: "2036-08-13T10:15:30.000Z",
          winningRule: "placed_on_market_plus_10_calendar_years",
          incompleteReasons: [],
          legalHoldActive: false,
        },
        {
          releaseId: "release-2",
          ruleVersion: RETENTION_RULE_VERSION,
          status: "current",
          placedOnMarketCandidate: "2037-08-13T10:15:30.000Z",
          supportPeriodCandidate: "2040-08-13T10:15:30.000Z",
          retentionUntil: "2040-08-13T10:15:30.000Z",
          retentionProtectionUntil: "2040-08-13T10:15:30.000Z",
          winningRule: "support_period_end",
          incompleteReasons: [],
          legalHoldActive: false,
        },
      ],
    });
  });

  it("preserves incomplete release reasons instead of aggregating a partial result", () => {
    expect(
      aggregateProductRetention([
        calculateReleaseRetention({
          releaseId: "release-1",
          placedOnMarketAt,
          supportEndsAt: "2030-08-13T10:15:30.000Z",
        }),
        calculateReleaseRetention({
          releaseId: "release-2",
          placedOnMarketAt: null,
          supportEndsAt: "2030-08-13T10:15:30.000Z",
        }),
      ]),
    ).toEqual({
      ruleVersion: RETENTION_RULE_VERSION,
      status: "incomplete",
      placedOnMarketCandidate: null,
      supportPeriodCandidate: null,
      retentionUntil: null,
      retentionProtectionUntil: "2036-08-13T10:15:30.000Z",
      winningRule: null,
      incompleteReasons: ["missing_placed_on_market_at"],
      legalHoldActive: false,
      releaseCalculations: [
        {
          releaseId: "release-1",
          ruleVersion: RETENTION_RULE_VERSION,
          status: "current",
          placedOnMarketCandidate: "2036-08-13T10:15:30.000Z",
          supportPeriodCandidate: "2030-08-13T10:15:30.000Z",
          retentionUntil: "2036-08-13T10:15:30.000Z",
          retentionProtectionUntil: "2036-08-13T10:15:30.000Z",
          winningRule: "placed_on_market_plus_10_calendar_years",
          incompleteReasons: [],
          legalHoldActive: false,
        },
        {
          releaseId: "release-2",
          ruleVersion: RETENTION_RULE_VERSION,
          status: "incomplete",
          placedOnMarketCandidate: null,
          supportPeriodCandidate: "2030-08-13T10:15:30.000Z",
          retentionUntil: null,
          retentionProtectionUntil: null,
          winningRule: null,
          incompleteReasons: ["missing_placed_on_market_at"],
          legalHoldActive: false,
        },
      ],
    });
  });

  it("keeps release identifiers attached to the explicit incomplete facts", () => {
    expect(
      aggregateProductRetention([
        calculateReleaseRetention({
          releaseId: "release-1",
          placedOnMarketAt: null,
          supportEndsAt: null,
        }),
      ]),
    ).toMatchObject({
      status: "incomplete",
      incompleteReasons: [
        "missing_placed_on_market_at",
        "missing_support_period",
      ],
    });
  });
});
