# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-session.spec.ts >> refreshes an expired access cookie, locks out, and clears the session
- Location: e2e/auth-session.spec.ts:5:1

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard\/analytics\?from=e2e$/
Received string:  "http://localhost:3000/login?redirectTo=%2Fdashboard%2Fanalytics%3Ffrom%3De2e"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    24 × locator resolved to <html lang="en" class="poppins_d1303497-module__6Wa_kq__className">…</html>
       - unexpected value "http://localhost:3000/login?redirectTo=%2Fdashboard%2Fanalytics%3Ffrom%3De2e"

```

```yaml
- region "Notifications alt+T"
- status
- region "Welcome Back":
  - heading "Welcome Back" [level=1]
  - paragraph: Login to ScienceBridge
  - text: Email
  - textbox "Email"
  - text: Password
  - textbox "Password"
  - button "Show password":
    - img
  - link "Forgot Password?":
    - /url: /forgot-password
  - checkbox "Remember this device"
  - text: Remember this device
  - paragraph: Keep me signed in on this private device for 30 days.
  - button "Login" [disabled]:
    - text: Login
    - img
  - text: New to ScienceBridge?
  - link "Sign up":
    - /url: /signup?redirectTo=%2Fdashboard%2Fanalytics%3Ffrom%3De2e
- alert
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | import { RunScopedAccounts } from "./helpers/accounts";
  4  | 
  5  | test("refreshes an expired access cookie, locks out, and clears the session", async ({
  6  |   page,
  7  | }, testInfo) => {
  8  |   const fixtures = new RunScopedAccounts(testInfo);
  9  |   try {
  10 |     const account = await fixtures.createVerified(
  11 |       page.context(),
  12 |       "auth-session",
  13 |     );
  14 |     await page.request.post("/api/v1/auth/sign-out", { data: {} });
  15 | 
  16 |     await page.goto("/sign-in");
  17 |     await page.getByTestId("si-identifier").fill(account.email);
  18 |     await page.getByTestId("si-password").fill(account.password);
  19 |     const signInResponse = page.waitForResponse((response) =>
  20 |       response.url().endsWith("/api/v1/auth/sign-in"),
  21 |     );
  22 |     await page.getByTestId("si-submit").click();
  23 |     const signedIn = await signInResponse;
  24 |     expect(signedIn.status()).toBe(200);
  25 |     // The successful form submission immediately navigates to the dashboard.
  26 |     // Chromium can discard a navigation response body before Playwright reads
  27 |     // it, so assert the durable browser outcome rather than a transient body.
  28 |     await expect(page).toHaveURL(/\/dashboard$/);
  29 |     await expect(page.getByRole("link", { name: "Products" })).toBeVisible();
  30 | 
  31 |     await page.context().clearCookies({ name: "cra_at" });
  32 |     const refreshResponse = page.waitForResponse((response) => {
  33 |       const url = new URL(response.url());
  34 |       return (
  35 |         url.pathname.endsWith("/api/v1/auth/refresh") &&
  36 |         url.searchParams.get("redirectTo") === "/dashboard/analytics?from=e2e"
  37 |       );
  38 |     });
  39 |     await page.goto("/dashboard/analytics?from=e2e");
  40 |     const refreshed = await refreshResponse;
  41 |     expect(refreshed.status()).toBe(302);
  42 |     expect(refreshed.url()).toContain(
  43 |       "redirectTo=%2Fdashboard%2Fanalytics%3Ffrom%3De2e",
  44 |     );
  45 |     expect(refreshed.headers().location).toContain(
  46 |       "/dashboard/analytics?from=e2e",
  47 |     );
> 48 |     await expect(page).toHaveURL(/\/dashboard\/analytics\?from=e2e$/);
     |                        ^ Error: expect(page).toHaveURL(expected) failed
  49 |     expect(
  50 |       (await page.context().cookies()).some(
  51 |         (cookie) => cookie.name === "cra_at",
  52 |       ),
  53 |     ).toBe(true);
  54 | 
  55 |     await page.goto("/lock");
  56 |     for (let attempt = 1; attempt <= 5; attempt += 1) {
  57 |       await page.getByTestId("lock-password").fill(`wrong-${attempt}`);
  58 |       const unlockResponse = page.waitForResponse((response) =>
  59 |         response.url().endsWith("/api/v1/auth/unlock"),
  60 |       );
  61 |       await page.getByTestId("lock-submit").click();
  62 |       const response = await unlockResponse;
  63 |       expect(response.status()).toBe(401);
  64 |       expect(await response.json()).toMatchObject({
  65 |         code: "invalid_credentials",
  66 |       });
  67 |     }
  68 | 
  69 |     await page.getByTestId("lock-password").fill(account.password);
  70 |     const lockedResponse = page.waitForResponse((response) =>
  71 |       response.url().endsWith("/api/v1/auth/unlock"),
  72 |     );
  73 |     await page.getByTestId("lock-submit").click();
  74 |     const locked = await lockedResponse;
  75 |     expect(locked.status()).toBe(429);
  76 |     expect(await locked.json()).toMatchObject({ code: "account_locked" });
  77 |     await expect(page.getByTestId("lock-error")).toBeVisible();
  78 | 
  79 |     const signedOut = await page.request.post("/api/v1/auth/sign-out", {
  80 |       data: {},
  81 |     });
  82 |     expect(signedOut.status()).toBe(200);
  83 |     expect(await signedOut.json()).toEqual({ ok: true });
  84 |     expect(
  85 |       (await page.context().cookies([page.url()])).filter((cookie) =>
  86 |         cookie.name.startsWith("cra_"),
  87 |       ),
  88 |     ).toEqual([]);
  89 |   } finally {
  90 |     await fixtures.cleanup();
  91 |   }
  92 | });
  93 | 
```