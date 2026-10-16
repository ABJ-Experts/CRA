import {
  SECURITY_UPDATE_AVAILABILITY_POLICY_VERSION,
  calculateSecurityUpdateAvailability,
} from "./security-update-availability-policy";

describe("security update availability policy", () => {
  it("uses the later issued-plus-ten-calendar-years candidate", () => {
    expect(
      calculateSecurityUpdateAvailability({
        issuedAt: "2024-02-29T23:30:00.000Z",
        supportEndsAt: "2030-02-28T23:30:00.000Z",
      }),
    ).toEqual({
      ruleVersion: SECURITY_UPDATE_AVAILABILITY_POLICY_VERSION,
      status: "current",
      issuedCandidate: "2034-02-28T23:30:00.000Z",
      supportCandidate: "2030-02-28T23:30:00.000Z",
      winningRule: "issued_at_plus_10_calendar_years",
      computedAvailabilityUntil: "2034-02-28T23:30:00.000Z",
      availabilityUntil: "2034-02-28T23:30:00.000Z",
      nonReductionApplied: false,
      incompleteReasons: [],
    });
  });

  it("reports equality and never reduces a later existing availability", () => {
    expect(
      calculateSecurityUpdateAvailability({
        issuedAt: "2026-08-17T12:00:00.000Z",
        supportEndsAt: "2036-08-17T12:00:00.000Z",
        existingAvailabilityUntil: "2037-08-17T12:00:00.000Z",
      }),
    ).toMatchObject({
      winningRule: "equal",
      computedAvailabilityUntil: "2036-08-17T12:00:00.000Z",
      availabilityUntil: "2037-08-17T12:00:00.000Z",
      nonReductionApplied: true,
    });
  });

  it("does not fabricate an availability window with missing required facts", () => {
    expect(
      calculateSecurityUpdateAvailability({
        issuedAt: null,
        supportEndsAt: null,
      }),
    ).toMatchObject({
      status: "incomplete",
      computedAvailabilityUntil: null,
      availabilityUntil: null,
      incompleteReasons: ["missing_issued_at", "missing_support_period"],
    });
  });
});
