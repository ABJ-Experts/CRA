# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: table-parity.spec.ts >> mock and real responses share Paged shape and filtering resets a late page once
- Location: e2e/table-parity.spec.ts:20:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Page 4' })

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - complementary [ref=f1e4]:
    - generic [ref=f1e5]:
      - generic [ref=f1e6]:
        - link "CRA Sentinel" [ref=f1e7] [cursor=pointer]:
          - /url: /dashboard
          - generic [ref=f1e8]: C
          - text: CRA Sentinel
        - button "Collapse sidebar" [ref=f1e9] [cursor=pointer]
      - navigation "Main" [ref=f1e12]:
        - generic [ref=f1e13]:
          - list [ref=f1e15]:
            - listitem [ref=f1e16]:
              - link "Dashboard" [ref=f1e17] [cursor=pointer]:
                - /url: /dashboard
            - listitem [ref=f1e25]:
              - link "Management" [ref=f1e26] [cursor=pointer]:
                - /url: /management
            - listitem [ref=f1e32]:
              - link "Organization" [ref=f1e33] [cursor=pointer]:
                - /url: /organization
            - listitem [ref=f1e40]:
              - link "Products" [ref=f1e41] [cursor=pointer]:
                - /url: /products
            - listitem [ref=f1e48]:
              - link "Connectors" [ref=f1e49] [cursor=pointer]:
                - /url: /connectors
          - generic [ref=f1e56]:
            - paragraph [ref=f1e57]: Account & access
            - list [ref=f1e58]:
              - listitem [ref=f1e59]:
                - button "Profile" [ref=f1e60] [cursor=pointer]
                - generic:
                  - list:
                    - listitem [ref=f1e68]:
                      - link "Account" [ref=f1e69] [cursor=pointer]:
                        - /url: /account
                    - listitem [ref=f1e71]:
                      - link "Security" [ref=f1e72] [cursor=pointer]:
                        - /url: /security
              - listitem [ref=f1e74]:
                - button "Authorization" [ref=f1e75] [cursor=pointer]
                - generic:
                  - list:
                    - listitem [ref=f1e83]:
                      - link "Roles" [ref=f1e84] [cursor=pointer]:
                        - /url: /roles
                    - listitem [ref=f1e86]:
                      - link "Permissions" [ref=f1e87] [cursor=pointer]:
                        - /url: /permissions
      - button "Sign out" [ref=f1e91] [cursor=pointer]
  - generic [ref=f1e96]:
    - banner [ref=f1e97]:
      - navigation "Breadcrumb" [ref=f1e99]:
        - list [ref=f1e100]:
          - listitem [ref=f1e101]:
            - link "Tables" [ref=f1e102] [cursor=pointer]:
              - /url: /dashboard/tables/basic
          - listitem [ref=f1e103]
          - listitem [ref=f1e106]:
            - generic [ref=f1e107]: Basic Tables
      - generic [ref=f1e108]:
        - button "Search" [ref=f1e109] [cursor=pointer]
        - button "Notifications, 7 unread" [ref=f1e113] [cursor=pointer]
        - 'img "Ada Foster: online" [ref=f1e120]'
    - main [ref=f1e121]:
      - generic [ref=f1e122]:
        - generic [ref=f1e123]:
          - searchbox "Search products" [ref=f1e128]
          - button "Filters" [ref=f1e130] [cursor=pointer]
        - generic [ref=f1e132]:
          - table "Products" [ref=f1e134]:
            - rowgroup [ref=f1e135]:
              - row [ref=f1e136]:
                - columnheader [ref=f1e137]:
                  - generic [ref=f1e139]:
                    - checkbox "Select all rows on this page" [ref=f1e140] [cursor=pointer]
                    - checkbox
                - columnheader "No." [ref=f1e141]
                - columnheader [ref=f1e142] [cursor=pointer]:
                  - button "SKU" [ref=f1e143]
                - columnheader [ref=f1e147] [cursor=pointer]:
                  - button "Product Name" [ref=f1e148]
                - columnheader [ref=f1e152] [cursor=pointer]:
                  - button "Last Update & Category" [ref=f1e153]
                - columnheader [ref=f1e157] [cursor=pointer]:
                  - button "Quantity & Price" [ref=f1e158]
                - columnheader [ref=f1e162]
            - rowgroup [ref=f1e163]:
              - row [ref=f1e164]:
                - cell [ref=f1e165]
                - cell [ref=f1e167]
                - cell [ref=f1e169]
                - cell [ref=f1e171]
                - cell [ref=f1e173]
                - cell [ref=f1e175]
                - cell [ref=f1e177]
              - row [ref=f1e179]:
                - cell [ref=f1e180]
                - cell [ref=f1e182]
                - cell [ref=f1e184]
                - cell [ref=f1e186]
                - cell [ref=f1e188]
                - cell [ref=f1e190]
                - cell [ref=f1e192]
              - row [ref=f1e194]:
                - cell [ref=f1e195]
                - cell [ref=f1e197]
                - cell [ref=f1e199]
                - cell [ref=f1e201]
                - cell [ref=f1e203]
                - cell [ref=f1e205]
                - cell [ref=f1e207]
              - row [ref=f1e209]:
                - cell [ref=f1e210]
                - cell [ref=f1e212]
                - cell [ref=f1e214]
                - cell [ref=f1e216]
                - cell [ref=f1e218]
                - cell [ref=f1e220]
                - cell [ref=f1e222]
              - row [ref=f1e224]:
                - cell [ref=f1e225]
                - cell [ref=f1e227]
                - cell [ref=f1e229]
                - cell [ref=f1e231]
                - cell [ref=f1e233]
                - cell [ref=f1e235]
                - cell [ref=f1e237]
              - row [ref=f1e239]:
                - cell [ref=f1e240]
                - cell [ref=f1e242]
                - cell [ref=f1e244]
                - cell [ref=f1e246]
                - cell [ref=f1e248]
                - cell [ref=f1e250]
                - cell [ref=f1e252]
              - row [ref=f1e254]:
                - cell [ref=f1e255]
                - cell [ref=f1e257]
                - cell [ref=f1e259]
                - cell [ref=f1e261]
                - cell [ref=f1e263]
                - cell [ref=f1e265]
                - cell [ref=f1e267]
              - row [ref=f1e269]:
                - cell [ref=f1e270]
                - cell [ref=f1e272]
                - cell [ref=f1e274]
                - cell [ref=f1e276]
                - cell [ref=f1e278]
                - cell [ref=f1e280]
                - cell [ref=f1e282]
              - row [ref=f1e284]:
                - cell [ref=f1e285]
                - cell [ref=f1e287]
                - cell [ref=f1e289]
                - cell [ref=f1e291]
                - cell [ref=f1e293]
                - cell [ref=f1e295]
                - cell [ref=f1e297]
              - row [ref=f1e299]:
                - cell [ref=f1e300]
                - cell [ref=f1e302]
                - cell [ref=f1e304]
                - cell [ref=f1e306]
                - cell [ref=f1e308]
                - cell [ref=f1e310]
                - cell [ref=f1e312]
          - navigation "Pagination" [ref=f1e314]:
            - generic [ref=f1e315]:
              - generic [ref=f1e316]: Rows per page
              - generic [ref=f1e317]:
                - combobox "Rows per page" [ref=f1e318] [cursor=pointer]
                - combobox [ref=f1e321]
              - generic [ref=f1e322]: 0-0 of 0
            - list [ref=f1e323]:
              - listitem [ref=f1e324]:
                - button "First" [disabled] [ref=f1e325]
              - listitem [ref=f1e326]:
                - button "Previous page" [disabled] [ref=f1e327]
              - listitem [ref=f1e330]:
                - button "Page 1" [ref=f1e331] [cursor=pointer]: "01"
              - listitem [ref=f1e332]:
                - button "Next page" [disabled] [ref=f1e333]
              - listitem [ref=f1e336]:
                - button "End" [disabled] [ref=f1e337]
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { setupServer } from "msw/node";
  3  | 
  4  | import { handlers } from "../mocks/handlers";
  5  | 
  6  | /* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */
  7  | 
  8  | const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
  9  | 
  10 | // The API passthrough handler is for browser/Next mocks. In this Node-side
  11 | // Playwright process it intercepts Playwright's API client too, so let those
  12 | // requests bypass while retaining the dashboard mock handlers under test.
  13 | const mockServer = setupServer(...handlers.slice(1));
  14 | 
  15 | function pagedKeys(value: unknown): string[] {
  16 |   if (!value || typeof value !== "object") return [];
  17 |   return Object.keys(value).sort();
  18 | }
  19 | 
  20 | test("mock and real responses share Paged shape and filtering resets a late page once", async ({
  21 |   page,
  22 | }) => {
  23 |   const signedIn = await page.request.post("/api/v1/auth/sign-in", {
  24 |     data: {
  25 |       email: "owner@cra.test",
  26 |       password: "Password123",
  27 |       remember: true,
  28 |     },
  29 |   });
  30 |   expect(signedIn.status()).toBe(200);
  31 | 
  32 |   const realResponse = await page.request.get(
  33 |     "/api/v1/users?page=1&pageSize=15",
  34 |   );
  35 |   expect(realResponse.status()).toBe(200);
  36 |   const realPage = await realResponse.json();
  37 | 
  38 |   mockServer.listen({ onUnhandledRequest: "error" });
  39 |   let mockPage: {
  40 |     rows: unknown[];
  41 |     total: number;
  42 |     page: number;
  43 |     pageSize: number;
  44 |     pageCount: number;
  45 |   };
  46 |   try {
  47 |     const mockResponse = await fetch(
  48 |       `${WEB_ORIGIN}/api/products?page=1&pageSize=15`,
  49 |     );
  50 |     expect(mockResponse.status).toBe(200);
  51 |     mockPage = (await mockResponse.json()) as typeof mockPage;
  52 |   } finally {
  53 |     mockServer.close();
  54 |   }
  55 | 
  56 |   expect(pagedKeys(mockPage)).toEqual([
  57 |     "page",
  58 |     "pageCount",
  59 |     "pageSize",
  60 |     "rows",
  61 |     "total",
  62 |   ]);
  63 |   expect(pagedKeys(realPage)).toEqual(pagedKeys(mockPage));
  64 | 
  65 |   let filteredRequests = 0;
  66 |   await page.route("**/api/products?**", async (route) => {
  67 |     const url = new URL(route.request().url());
  68 |     const filtered = Boolean(url.searchParams.get("q"));
  69 |     if (filtered) filteredRequests += 1;
  70 |     const requestedPage = Number(url.searchParams.get("page") ?? "1");
  71 |     await route.fulfill({
  72 |       status: 200,
  73 |       contentType: "application/json",
  74 |       body: JSON.stringify({
  75 |         ...mockPage,
  76 |         rows: mockPage.rows.slice(0, filtered ? 1 : 15),
  77 |         total: filtered ? 1 : Math.max(mockPage.total, 60),
  78 |         page: filtered ? 1 : requestedPage,
  79 |         pageCount: filtered ? 1 : Math.max(mockPage.pageCount, 4),
  80 |       }),
  81 |     });
  82 |   });
  83 | 
  84 |   await page.goto("/dashboard/tables/basic");
  85 |   await expect(page.getByRole("table", { name: "Products" })).toBeVisible();
> 86 |   await page.getByRole("button", { name: "Page 4" }).click();
     |                                                      ^ Error: locator.click: Test timeout of 45000ms exceeded.
  87 |   await expect(page.getByRole("button", { name: "Page 4" })).toHaveAttribute(
  88 |     "aria-current",
  89 |     "page",
  90 |   );
  91 |   await page.getByRole("searchbox", { name: "Search products" }).fill("anker");
  92 |   await expect(page.getByRole("button", { name: "Page 1" })).toHaveAttribute(
  93 |     "aria-current",
  94 |     "page",
  95 |   );
  96 |   await expect.poll(() => filteredRequests).toBe(1);
  97 | });
  98 | 
```