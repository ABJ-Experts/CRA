import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  portfolioScope,
  portfolioEvidence,
  portfolioError,
} from "./portfolio-policy";

describe("portfolio scope and evidence policy", () => {
  it("binds identity, organization, session revision and permissions deterministically", () => {
    const a = portfolioScope("org", "actor", 1, { b: true, a: false });
    expect(a).toBe(portfolioScope("org", "actor", 1, { a: false, b: true }));
    expect(a).not.toBe(
      portfolioScope("other", "actor", 1, { b: true, a: false }),
    );
    expect(a).not.toBe(
      portfolioScope("org", "actor", 2, { b: true, a: false }),
    );
  });
  it("never retains unauthorized, conflicting, malformed or foreign evidence", () => {
    const value = { organizationId: "org" };
    expect(portfolioEvidence(value, "org", true, null)).toBe(value);
    expect(
      portfolioEvidence(
        value,
        "org",
        true,
        new ApiClientError("network", "Offline"),
      ),
    ).toBe(value);
    expect(
      portfolioEvidence(
        value,
        "org",
        true,
        new ApiClientError("api", "Down", 503),
      ),
    ).toBe(value);
    for (const error of [
      new ApiClientError("api", "Denied", 401),
      new ApiClientError("api", "Denied", 403),
      new ApiClientError("api", "Conflict", 409),
      new Error("Invalid"),
    ])
      expect(portfolioEvidence(value, "org", true, error)).toBeUndefined();
    expect(portfolioEvidence(value, "other", true, null)).toBeUndefined();
    expect(portfolioEvidence(value, "org", false, null)).toBeUndefined();
    expect(portfolioEvidence(undefined, "org", true, null)).toBeUndefined();
  });
  it("provides distinct conflict, access, invalid cursor and retry guidance", () => {
    expect(portfolioError(new ApiClientError("api", "Changed", 409))).toContain(
      "changed",
    );
    expect(portfolioError(new ApiClientError("api", "Denied", 403))).toContain(
      "access",
    );
    expect(portfolioError(new ApiClientError("api", "Expired", 400))).toContain(
      "expired",
    );
    expect(portfolioError(new Error("Offline"))).toContain("Retry");
  });
});
