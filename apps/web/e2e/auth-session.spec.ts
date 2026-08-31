import { expect, test } from "@playwright/test";

import { RunScopedAccounts } from "./helpers/accounts";

test("refreshes an expired access cookie, locks out, and clears the session", async ({
  page,
}, testInfo) => {
  const fixtures = new RunScopedAccounts(testInfo);
  try {
    const account = await fixtures.createVerified(
      page.context(),
      "auth-session",
    );
    await page.request.post("/api/v1/auth/sign-out", { data: {} });

    await page.goto("/sign-in");
    await page.getByTestId("si-identifier").fill(account.email);
    await page.getByTestId("si-password").fill(account.password);
    const signInResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/auth/sign-in"),
    );
    await page.getByTestId("si-submit").click();
    const signedIn = await signInResponse;
    expect(signedIn.status()).toBe(200);
    expect(await signedIn.json()).toMatchObject({ next: "dashboard" });
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("link", { name: "Products" })).toBeVisible();

    await page.context().clearCookies({ name: "cra_at" });
    const refreshResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/api/v1/auth/refresh") &&
        url.searchParams.get("redirectTo") === "/dashboard/analytics?from=e2e"
      );
    });
    await page.goto("/dashboard/analytics?from=e2e");
    const refreshed = await refreshResponse;
    expect(refreshed.status()).toBe(302);
    expect(refreshed.url()).toContain(
      "redirectTo=%2Fdashboard%2Fanalytics%3Ffrom%3De2e",
    );
    expect(refreshed.headers().location).toContain(
      "/dashboard/analytics?from=e2e",
    );
    await expect(page).toHaveURL(/\/dashboard\/analytics\?from=e2e$/);
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === "cra_at",
      ),
    ).toBe(true);

    await page.goto("/lock");
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await page.getByTestId("lock-password").fill(`wrong-${attempt}`);
      const unlockResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/v1/auth/unlock"),
      );
      await page.getByTestId("lock-submit").click();
      const response = await unlockResponse;
      expect(response.status()).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "invalid_credentials",
      });
    }

    await page.getByTestId("lock-password").fill(account.password);
    const lockedResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/auth/unlock"),
    );
    await page.getByTestId("lock-submit").click();
    const locked = await lockedResponse;
    expect(locked.status()).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "account_locked" });
    await expect(page.getByTestId("lock-error")).toBeVisible();

    const signedOut = await page.request.post("/api/v1/auth/sign-out", {
      data: {},
    });
    expect(signedOut.status()).toBe(200);
    expect(await signedOut.json()).toEqual({ ok: true });
    expect(
      (await page.context().cookies()).filter((cookie) =>
        cookie.name.startsWith("cra_"),
      ),
    ).toEqual([]);
  } finally {
    await fixtures.cleanup();
  }
});
