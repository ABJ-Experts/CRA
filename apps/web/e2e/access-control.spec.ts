import { expect, test } from "@playwright/test";

import { RunScopedAccounts, signIn } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

test("revocation is immediate, outages stay visible, and restored checks do not reuse a grant", async ({
  browser,
  page,
}, testInfo) => {
  const fixtures = new RunScopedAccounts(testInfo);
  const memberContext = await browser.newContext({
    baseURL: WEB_ORIGIN,
  });
  try {
    expect((await signIn(page.request, "owner@cra.test")).status()).toBe(200);
    const member = await fixtures.createVerified(
      memberContext,
      "access-control",
    );
    const invitationResponse = await page.request.post("/api/v1/invitations", {
      data: { email: member.email, role: "admin" },
    });
    expect(invitationResponse.status()).toBe(201);
    const invitation = (await invitationResponse.json()) as { id: string };
    fixtures.trackInvitation(invitation.id);
    const token = await fixtures.invitationToken(member.email);
    const accepted = await memberContext.request.post(
      "/api/v1/invitations/accept",
      {
        data: { token },
      },
    );
    expect(accepted.status()).toBe(200);

    const granted = await memberContext.request.get("/api/v1/users");
    expect(granted.status()).toBe(200);
    expect(await granted.json()).toMatchObject({ page: 1, pageSize: 15 });

    const revoked = await page.request.patch(
      `/api/v1/users/${member.publicUserId}/role`,
      {
        data: { role: "member" },
      },
    );
    expect(revoked.status()).toBe(200);
    const denied = await memberContext.request.get("/api/v1/users");
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({
      code: "insufficient_permissions",
    });

    const memberPage = await memberContext.newPage();
    await memberPage.route("**/api/v1/users?**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 503,
          message: "Permission store temporarily unavailable.",
          code: "permission_store_unavailable",
        }),
      });
    });
    const unavailable = memberPage.waitForResponse((response) =>
      response.url().includes("/api/v1/users?"),
    );
    await memberPage.goto("/management");
    const outage = await unavailable;
    expect(outage.status()).toBe(503);
    expect(await outage.json()).toMatchObject({
      code: "permission_store_unavailable",
    });
    await expect(
      memberPage.getByText("Could not load this table", { exact: true }),
    ).toBeVisible();
    await expect(memberPage.getByText("Role changed")).toHaveCount(0);

    await memberPage.unroute("**/api/v1/users?**");
    const restored = await memberPage.request.get("/api/v1/users");
    expect(restored.status()).toBe(403);
    expect(await restored.json()).toMatchObject({
      code: "insufficient_permissions",
    });
  } finally {
    await memberContext.close();
    await fixtures.cleanup();
  }
});
