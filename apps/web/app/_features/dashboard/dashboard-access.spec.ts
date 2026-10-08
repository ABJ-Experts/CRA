import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  isDashboardAuthorizationFailure,
  revokeDashboardScope,
} from "./dashboard-access";
describe("scope-wide dashboard evidence revocation", () => {
  it("recognizes definitive authorization only", () => {
    for (const status of [401, 403])
      expect(
        isDashboardAuthorizationFailure(
          new ApiClientError("api", "Denied", status),
        ),
      ).toBe(true);
    for (const error of [
      new ApiClientError("api", "Bad cursor", 400),
      new ApiClientError("api", "Unavailable", 503),
      new Error("Offline"),
      null,
    ])
      expect(isDashboardAuthorizationFailure(error)).toBe(false);
  });
  it("removes one complete scope and reauthorizes identity permissions and menu", () => {
    const client = new QueryClient();
    client.setQueryData(["dashboard", "one", "overview"], { evidence: true });
    client.setQueryData(["dashboard", "one", "readiness", "cursor"], {
      evidence: true,
    });
    client.setQueryData(["dashboard", "two", "overview"], { evidence: true });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    revokeDashboardScope(client, "one");
    expect(client.getQueriesData({ queryKey: ["dashboard", "one"] })).toEqual(
      [],
    );
    expect(client.getQueryData(["dashboard-access", "one"])).toBe(true);
    expect(client.getQueryData(["dashboard", "two", "overview"])).toEqual({
      evidence: true,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["session"] });
    client.clear();
  });
});
