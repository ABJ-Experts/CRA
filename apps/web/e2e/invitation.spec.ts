import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";

import { RunScopedAccounts, signIn } from "./helpers/accounts";

async function createInvitation(
  owner: APIRequestContext,
  fixtures: RunScopedAccounts,
  email: string,
): Promise<{ id: string; token: string }> {
  const response = await owner.post("/api/v1/invitations", {
    data: { email, role: "member", firstName: "E2E", lastName: "Recipient" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id: string };
  fixtures.trackInvitation(body.id);
  return { id: body.id, token: await fixtures.invitationToken(email) };
}

async function acceptInBrowser(
  context: BrowserContext,
  token: string,
  already: boolean,
) {
  const page = await context.newPage();
  const pending = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/invitations/accept"),
  );
  await page.goto(`/accept-invitation?token=${encodeURIComponent(token)}`);
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ alreadyAccepted: already });
  await expect(
    page.getByRole("heading", {
      name: already ? "You are already a member" : "You are in",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.close();
}

test("accepts once idempotently and refuses revoked and expired links", async ({
  browser,
  page,
}, testInfo) => {
  const fixtures = new RunScopedAccounts(testInfo);
  const recipientContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  const revokedContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  const expiredContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  try {
    const ownerSignIn = await signIn(page.request, "owner@cra.test");
    expect(ownerSignIn.status()).toBe(200);
    const recipient = await fixtures.createVerified(
      recipientContext,
      "invited",
    );
    const revokedRecipient = await fixtures.createVerified(
      revokedContext,
      "revoked",
    );
    const expiredRecipient = await fixtures.createVerified(
      expiredContext,
      "expired",
    );

    const invitation = await createInvitation(
      page.request,
      fixtures,
      recipient.email,
    );
    await acceptInBrowser(recipientContext, invitation.token, false);
    await acceptInBrowser(recipientContext, invitation.token, true);

    const members = await page.request.get(
      `/api/v1/users?q=${encodeURIComponent(recipient.email)}`,
    );
    expect(members.status()).toBe(200);
    const memberBody = (await members.json()) as { rows: { email: string }[] };
    expect(
      memberBody.rows.filter((row) => row.email === recipient.email),
    ).toHaveLength(1);

    const revoked = await createInvitation(
      page.request,
      fixtures,
      revokedRecipient.email,
    );
    const revokeResponse = await page.request.delete(
      `/api/v1/invitations/${revoked.id}`,
    );
    expect(revokeResponse.status()).toBe(200);
    const revokedAttempt = await revokedContext.request.post(
      "/api/v1/invitations/accept",
      {
        data: { token: revoked.token },
      },
    );
    expect(revokedAttempt.status()).toBe(400);
    expect(await revokedAttempt.json()).toMatchObject({
      code: "invitation_not_pending",
    });

    const expired = await createInvitation(
      page.request,
      fixtures,
      expiredRecipient.email,
    );
    await fixtures.expireInvitation(expired.id);
    const expiredAttempt = await expiredContext.request.post(
      "/api/v1/invitations/accept",
      {
        data: { token: expired.token },
      },
    );
    expect(expiredAttempt.status()).toBe(400);
    expect(await expiredAttempt.json()).toMatchObject({
      code: "invitation_expired",
    });
  } finally {
    await Promise.all([
      recipientContext.close(),
      revokedContext.close(),
      expiredContext.close(),
    ]);
    await fixtures.cleanup();
  }
});
