import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { createRefreshTarget, shouldAttemptRefresh } from "./middleware";

describe("createRefreshTarget", () => {
  it("keeps token refresh on the web origin", () => {
    const request = new NextRequest(
      "http://localhost:3000/dashboard?tab=security",
    );

    expect(createRefreshTarget(request).toString()).toBe(
      "http://localhost:3000/api/v1/auth/refresh?redirectTo=%2Fdashboard%3Ftab%3Dsecurity",
    );
  });
});

describe("refresh routing", () => {
  it("refreshes an expired token", () => {
    expect(shouldAttemptRefresh(true, "expired", false)).toBe(true);
  });

  it("refreshes an absent access cookie when a session marker exists", () => {
    expect(shouldAttemptRefresh(true, "absent", true)).toBe(true);
  });

  it("sends a genuinely signed-out user to sign-in", () => {
    expect(shouldAttemptRefresh(true, "absent", false)).toBe(false);
  });

  it("never refreshes an invalid bearer", () => {
    expect(shouldAttemptRefresh(true, "invalid", true)).toBe(false);
  });

  it("never refreshes an unprotected route", () => {
    expect(shouldAttemptRefresh(false, "expired", true)).toBe(false);
  });
});
