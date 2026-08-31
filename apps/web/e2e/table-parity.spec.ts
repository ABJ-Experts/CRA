import { expect, test } from "@playwright/test";
import { setupServer } from "msw/node";

import { handlers } from "../mocks/handlers";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

// The API passthrough handler is for browser/Next mocks. In this Node-side
// Playwright process it intercepts Playwright's API client too, so let those
// requests bypass while retaining the dashboard mock handlers under test.
const mockServer = setupServer(...handlers.slice(1));

function pagedKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value).sort();
}

test("mock and real responses share Paged shape and filtering resets a late page once", async ({
  page,
}) => {
  const signedIn = await page.request.post("/api/v1/auth/sign-in", {
    data: {
      email: "owner@cra.test",
      password: "Password123",
      remember: true,
    },
  });
  expect(signedIn.status()).toBe(200);

  const realResponse = await page.request.get(
    "/api/v1/users?page=1&pageSize=15",
  );
  expect(realResponse.status()).toBe(200);
  const realPage = await realResponse.json();

  mockServer.listen({ onUnhandledRequest: "error" });
  let mockPage: {
    rows: unknown[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
  try {
    const mockResponse = await fetch(
      `${WEB_ORIGIN}/api/products?page=1&pageSize=15`,
    );
    expect(mockResponse.status).toBe(200);
    mockPage = (await mockResponse.json()) as typeof mockPage;
  } finally {
    mockServer.close();
  }

  expect(pagedKeys(mockPage)).toEqual([
    "page",
    "pageCount",
    "pageSize",
    "rows",
    "total",
  ]);
  expect(pagedKeys(realPage)).toEqual(pagedKeys(mockPage));

  let filteredRequests = 0;
  await page.route("**/api/products?**", async (route) => {
    const url = new URL(route.request().url());
    const filtered = Boolean(url.searchParams.get("q"));
    if (filtered) filteredRequests += 1;
    const requestedPage = Number(url.searchParams.get("page") ?? "1");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...mockPage,
        rows: mockPage.rows.slice(0, filtered ? 1 : 15),
        total: filtered ? 1 : Math.max(mockPage.total, 60),
        page: filtered ? 1 : requestedPage,
        pageCount: filtered ? 1 : Math.max(mockPage.pageCount, 4),
      }),
    });
  });

  await page.goto("/dashboard/tables/basic");
  await expect(page.getByRole("table", { name: "Products" })).toBeVisible();
  await page.getByRole("button", { name: "Page 4" }).click();
  await expect(page.getByRole("button", { name: "Page 4" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("searchbox", { name: "Search products" }).fill("anker");
  await expect(page.getByRole("button", { name: "Page 1" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect.poll(() => filteredRequests).toBe(1);
});
