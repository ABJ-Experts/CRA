import { describe, expect, it } from "vitest";
import {
  dashboardNow,
  countdownLabel,
  retainsDashboardEvidence,
} from "./dashboard-clock";
import { ApiClientError } from "../../_lib/http/api-client";

describe("dashboard clock and authorized retention", () => {
  it("advances database time using monotonic elapsed time", () => {
    expect(dashboardNow("2026-10-07T12:00:00Z", 100, 1100)).toBe(
      Date.parse("2026-10-07T12:00:01Z"),
    );
    expect(dashboardNow("2026-10-07T12:00:00Z", 100, 50)).toBe(
      Date.parse("2026-10-07T12:00:00Z"),
    );
  });
  it("never invents clocks for pending or completed stages", () => {
    expect(countdownLabel(null, "pending_anchor", 0)).toBe("Awaiting trigger");
    expect(countdownLabel("2026-10-07T12:00:00Z", "cancelled", 0)).toBe(
      "Cancelled",
    );
    expect(countdownLabel("2026-10-07T12:00:00Z", "submitted", 0)).toBe(
      "Submitted",
    );
    expect(countdownLabel(null, "not_required", 0)).toBe("Not required");
  });
  it("formats running and elapsed deadlines without creating breach decisions", () => {
    expect(
      countdownLabel(
        "2026-10-07T12:00:00Z",
        "running",
        Date.parse("2026-10-07T10:59:59Z"),
      ),
    ).toBe("1h 0m 1s remaining");
    expect(
      countdownLabel(
        "2026-10-07T12:00:00Z",
        "overdue",
        Date.parse("2026-10-07T13:00:00Z"),
      ),
    ).toBe("1h 0m 0s elapsed");
  });
  it("clears evidence on definitive authorization or corrupt response", () => {
    for (const status of [401, 403, 404])
      expect(
        retainsDashboardEvidence(new ApiClientError("api", "Denied", status)),
      ).toBe(false);
    expect(
      retainsDashboardEvidence(
        new ApiClientError("invalid_response", "Invalid"),
      ),
    ).toBe(false);
    expect(
      retainsDashboardEvidence(new ApiClientError("network", "Offline")),
    ).toBe(true);
    expect(
      retainsDashboardEvidence(new ApiClientError("api", "Unavailable", 503)),
    ).toBe(true);
    expect(retainsDashboardEvidence(new Error("Other"))).toBe(false);
  });
});
