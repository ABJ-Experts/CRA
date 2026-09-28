import { describe, expect, it } from "vitest";
import { supportPeriodHistoryQuerySchema } from "./support-period-retention.schema.js";

describe("support period history query", () => {
  it("permits product-wide history and an exact release", () => {
    expect(supportPeriodHistoryQuerySchema.parse({})).toEqual({});
    const releaseId = "00000000-0000-4000-8000-000000000001";
    expect(supportPeriodHistoryQuerySchema.parse({ releaseId })).toEqual({
      releaseId,
    });
  });
  it.each([
    { releaseId: "invalid" },
    { releaseId: ["00000000-0000-4000-8000-000000000001"] },
    { organizationId: "other" },
    { productId: "other" },
  ])("rejects malformed or substituted scope %j", (query) => {
    expect(supportPeriodHistoryQuerySchema.safeParse(query).success).toBe(
      false,
    );
  });
});
