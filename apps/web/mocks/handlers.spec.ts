// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  coinSchema,
  customerSchema,
  orderSchema,
  productSchema,
} from "./data/table-schemas";
import { handlers } from "./handlers";
import { server } from "./server";

/**
 * MSW and the real API share the `/api` namespace, and the collision would be
 * intermittent rather than obvious: the browser service worker, `msw/node`
 * started from `instrumentation.ts`, and a production build each resolve it
 * differently. So the separation is asserted rather than assumed.
 */

function pathOf(handler: (typeof handlers)[number]): string {
  return String((handler as { info: { path: unknown } }).info.path);
}

describe("mock/API namespace separation", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it("passes the real API through, and does so FIRST", () => {
    // MSW matches in array order, first match wins. If a dashboard mock were
    // ordered ahead of this and its pattern ever widened, real auth calls would
    // start being answered by a fixture.
    expect(pathOf(handlers[0]!)).toBe("*/api/v1/*");
  });

  it("has no dashboard mock inside the API prefix", () => {
    const collisions = handlers
      .slice(1)
      .map(pathOf)
      .filter((p) => p.includes("/api/v1"));

    expect(collisions).toEqual([]);
  });

  it("still mocks the four dashboard endpoints the tables depend on", () => {
    // The existing dashboard must keep working with no API and no database.
    const paths = handlers.map(pathOf).map((path) => path.replace(/^\*/, ""));
    for (const endpoint of [
      "/api/products",
      "/api/orders",
      "/api/customers",
      "/api/coins",
    ]) {
      expect(paths).toContain(endpoint);
    }
  });

  it.each([
    ["products", productSchema],
    ["orders", orderSchema],
    ["customers", customerSchema],
    ["coins", coinSchema],
  ] as const)(
    "returns contract-valid paged %s data",
    async (endpoint, schema) => {
      const response = await fetch(`/api/${endpoint}?page=1&pageSize=2`);
      const body = (await response.json()) as {
        rows: unknown[];
        total: number;
        page: number;
        pageSize: number;
        pageCount: number;
      };

      expect(response.ok).toBe(true);
      expect(body.rows).toHaveLength(2);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(2);
      expect(body.total).toBeGreaterThan(2);
      expect(body.pageCount).toBe(Math.ceil(body.total / 2));
      for (const row of body.rows)
        expect(schema.safeParse(row).success).toBe(true);
    },
  );

  it("filters, sorts numeric display values, and clamps stale pages", async () => {
    const filtered = await fetch(
      "/api/products?q=anker&page=999&pageSize=1&sort=price&order=desc",
    );
    const body = (await filtered.json()) as {
      rows: Array<{ name: string }>;
      total: number;
      page: number;
      pageCount: number;
    };

    expect(body.total).toBeGreaterThan(0);
    expect(body.rows[0]?.name.toLowerCase()).toContain("anker");
    expect(body.page).toBe(body.pageCount);

    const sorted = await fetch(
      "/api/products?pageSize=100&sort=price&order=desc",
    );
    const prices = (
      (await sorted.json()) as { rows: Array<{ price: string }> }
    ).rows.map((row) => Number(row.price.replace(/[^0-9.-]/g, "")));
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it("returns an explicit server error for the table retry path", async () => {
    const response = await fetch("/api/orders?fail=1");

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });
});
