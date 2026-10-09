// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { operationError, operationDate } from "./connector-operation-ui";
import { ApiClientError } from "../../_lib/http/api-client";
describe("safe operational messages", () => {
  it("distinguishes offline, authorization, conflict and safe API categories", () => {
    expect(
      operationError(new ApiClientError("api", "forbidden", 403), "fallback"),
    ).toContain("permission");
    expect(
      operationError(new ApiClientError("api", "conflict", 409), "fallback"),
    ).toContain("draft is preserved");
    expect(
      operationError(
        new ApiClientError("network", "internal socket", 0),
        "fallback",
      ),
    ).toContain("unreachable");
    expect(
      operationError(
        new ApiClientError("api", "Safe approved category", 422),
        "fallback",
      ),
    ).toBe("Safe approved category");
    expect(operationError(new Error("secret-canary"), "fallback")).toBe(
      "fallback",
    );
    expect(operationDate("2026-09-29T10:00:00Z")).not.toBe("Not recorded");
    expect(operationDate(null)).toBe("Not recorded");
  });
});
