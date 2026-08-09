import { describe, expect, it } from "vitest";

import { handlers } from "./handlers";

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
  it("passes the real API through, and does so FIRST", () => {
    // MSW matches in array order, first match wins. If a dashboard mock were
    // ordered ahead of this and its pattern ever widened, real auth calls would
    // start being answered by a fixture.
    expect(pathOf(handlers[0]!)).toBe("/api/v1/*");
  });

  it("has no dashboard mock inside the API prefix", () => {
    const collisions = handlers
      .slice(1)
      .map(pathOf)
      .filter((p) => p.startsWith("/api/v1"));

    expect(collisions).toEqual([]);
  });

  it("still mocks the four dashboard endpoints the tables depend on", () => {
    // The existing dashboard must keep working with no API and no database.
    const paths = handlers.map(pathOf);
    for (const endpoint of [
      "/api/products",
      "/api/orders",
      "/api/customers",
      "/api/coins",
    ]) {
      expect(paths).toContain(endpoint);
    }
  });
});
