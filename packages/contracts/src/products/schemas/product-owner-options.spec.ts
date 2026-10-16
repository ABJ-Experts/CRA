import { describe, expect, it } from "vitest";
import {
  productOwnerOptionsQuerySchema,
  productOwnerOptionsResponseSchema,
} from "./product-owner-options.schema.js";
describe("product owner contracts", () => {
  it("defaults bounded pagination", () => {
    expect(productOwnerOptionsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
  });
  it.each([
    { organizationId: "other" },
    { pageSize: 101 },
    { page: 0 },
    { q: "x".repeat(201) },
    { selectedOwnerId: "bad" },
    { productId: "bad" },
    {
      productId: "11111111-1111-4111-8111-111111111111",
      selectedOwnerId: "11111111-1111-4111-8111-111111111111",
    },
  ])("rejects untrusted query %j", (query) => {
    expect(productOwnerOptionsQuerySchema.safeParse(query).success).toBe(false);
  });
  it("rejects personal data in owner projection", () => {
    expect(
      productOwnerOptionsResponseSchema.safeParse({
        owners: {
          rows: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              displayName: "Owner",
              email: "private",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          pageCount: 1,
        },
        selectedOwner: null,
      }).success,
    ).toBe(false);
  });
});
