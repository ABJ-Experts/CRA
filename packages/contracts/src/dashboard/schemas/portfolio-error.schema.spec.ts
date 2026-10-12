import { describe, expect, it } from "vitest";
import { portfolioErrorSchema } from "./portfolio.schema.js";
describe("portfolio error contract", () => {
  it.each([
    "not_found",
    "forbidden",
    "invalid_cursor",
    "portfolio_scope_changed",
    "portfolio_unavailable",
  ])("accepts stable %s errors", (code) => {
    expect(
      portfolioErrorSchema.parse({ code, message: "Report scope unavailable" }),
    ).toEqual({ code, message: "Report scope unavailable" });
  });
  it("rejects unknown codes, empty messages and internal diagnostics", () => {
    for (const input of [
      { code: "internal_sql", message: "Report unavailable" },
      { code: "forbidden", message: " " },
      {
        code: "forbidden",
        message: "Report unavailable",
        sql: "select hidden",
      },
      { code: "forbidden", message: "x".repeat(501) },
    ])
      expect(portfolioErrorSchema.safeParse(input).success).toBe(false);
  });
});
