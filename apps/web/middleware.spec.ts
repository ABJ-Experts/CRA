import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { createRefreshTarget } from "./middleware";

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
