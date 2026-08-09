import { pagedSchema } from "@repo/contracts/pagination";
import { describe, expect, it } from "vitest";

import { COINS, CUSTOMERS, ORDERS, PRODUCTS } from "./tables";
import {
  coinSchema,
  customerSchema,
  orderSchema,
  productSchema,
} from "./table-schemas";

describe("table row schemas", () => {
  it.each([
    ["products", productSchema, PRODUCTS],
    ["orders", orderSchema, ORDERS],
    ["customers", customerSchema, CUSTOMERS],
    ["coins", coinSchema, COINS],
  ] as const)("validates every committed %s row", (_name, schema, rows) => {
    expect(() => schema.array().parse(rows)).not.toThrow();
  });

  it.each([
    [productSchema, PRODUCTS[0]],
    [orderSchema, ORDERS[0]],
    [customerSchema, CUSTOMERS[0]],
    [coinSchema, COINS[0]],
  ] as const)("rejects unknown fields", (schema, row) => {
    expect(
      schema.safeParse({ ...row, unexpectedProviderField: true }).success,
    ).toBe(false);
  });

  it("rejects malformed row primitives and enums", () => {
    expect(
      productSchema.safeParse({ ...PRODUCTS[0], status: "Archived" }).success,
    ).toBe(false);
    expect(orderSchema.safeParse({ ...ORDERS[0], quantity: -1 }).success).toBe(
      false,
    );
    expect(
      customerSchema.safeParse({ ...CUSTOMERS[0], email: "invalid" }).success,
    ).toBe(false);
    expect(coinSchema.safeParse({ ...COINS[0], h24: Number.NaN }).success).toBe(
      false,
    );
  });
});

describe("paged table response schema", () => {
  const validPage = {
    rows: [PRODUCTS[0]],
    total: 1,
    page: 1,
    pageSize: 15,
    pageCount: 1,
  };
  const schema = pagedSchema(productSchema);

  it("accepts the shared paged response shape", () => {
    expect(schema.parse(validPage)).toEqual(validPage);
  });

  it.each([
    { ...validPage, total: -1 },
    { ...validPage, page: 0 },
    { ...validPage, pageCount: 0 },
    { ...validPage, pageSize: 101 },
    { ...validPage, rows: [{ ...PRODUCTS[0], no: 0 }] },
  ])("rejects an invalid response boundary", (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
