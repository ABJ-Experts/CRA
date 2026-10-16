import { expect, test, type Page } from "@playwright/test";

type Submission = Readonly<{
  id: string;
  fileName: string;
  state: string;
  evidenceProcessingState: string;
}>;
type ReviewRequest = Readonly<{
  id: string;
  supplierId: string;
  productId: string;
  submissions: ReadonlyArray<Submission>;
  reviewItems: ReadonlyArray<{
    submissions: ReadonlyArray<Submission>;
  }>;
}>;
type Extraction = Readonly<{
  run: null | { status: string };
  suggestions: ReadonlyArray<{
    id: string;
    origin: string;
    originalValue: string | null;
    correctedValue: string | null;
    sourceSpan: null | { quote: string };
  }>;
}>;

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  const signedIn = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/sign-in"),
  );
  await page.getByTestId("si-submit").click();
  expect((await signedIn).status()).toBe(200);
}

async function acceptedCleanSubmission(page: Page) {
  let cursor: string | null = null;
  let fallback: { request: ReviewRequest; submission: Submission } | undefined =
    undefined;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const list = await page.request.get(
      `/api/v1/supplier-evidence-requests?${query.toString()}`,
    );
    expect(list.status(), "Owner must be able to list supplier evidence").toBe(
      200,
    );
    const payload = (await list.json()) as {
      requests: ReadonlyArray<{ id: string }>;
      nextCursor: string | null;
    };
    for (const summary of payload.requests) {
      const detail = await page.request.get(
        `/api/v1/supplier-evidence-requests/${summary.id}/review`,
      );
      expect(
        detail.status(),
        "Owner must be able to read reviewer details",
      ).toBe(200);
      const body = (await detail.json()) as { request: ReviewRequest };
      const submission = body.request.submissions.find(
        (candidate) =>
          candidate.state === "accepted" &&
          candidate.evidenceProcessingState === "clean",
      );
      if (submission) {
        const extraction = await page.request.get(
          `/api/v1/supplier-evidence-requests/${body.request.id}/submissions/${submission.id}/extraction?productId=${body.request.productId}`,
        );
        if (extraction.ok()) {
          const extractionBody = (await extraction.json()) as Extraction;
          if (
            extractionBody.suggestions.some(
              (field) => field.origin === "ai" && field.sourceSpan?.quote,
            )
          ) {
            return { request: body.request, submission };
          }
        }
        fallback ??= { request: body.request, submission };
      }
    }
    cursor = payload.nextCursor;
    if (!cursor) break;
  }
  if (fallback) return fallback;
  throw new Error(
    "M9-05 requires an accepted, clean supplier submission in the local owner organization. Seed or review one before running this browser test.",
  );
}

test("owner reviews version-pinned suggestions and records a manual field through an extraction outage", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const { request, submission } = await acceptedCleanSubmission(page);
  await page.goto(`/suppliers/${request.supplierId}`);
  await expect(
    page.getByRole("heading", { name: "Supplier evidence review" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Evidence request" })
    .selectOption(request.id);
  const panel = page.getByRole("region", {
    name: `Document fields for ${submission.fileName}`,
  });
  await expect(panel).toBeVisible();

  const extractionPath = `/api/v1/supplier-evidence-requests/${request.id}/submissions/${submission.id}/extraction?productId=${request.productId}`;
  const uiExtractionPath = `${extractionPath}&limit=25`;
  const firstRead = await page.request.get(extractionPath);
  expect(firstRead.status()).toBe(200);
  const firstExtraction = (await firstRead.json()) as Extraction;
  const grounded = firstExtraction.suggestions.find(
    (field) => field.origin === "ai" && field.sourceSpan?.quote,
  );
  if (grounded?.sourceSpan) {
    await panel
      .getByRole("button", {
        name: `View source for ${grounded.originalValue}`,
      })
      .first()
      .click();
    await expect(panel.locator("mark")).toContainText(
      grounded.sourceSpan.quote,
    );
  } else {
    testInfo.annotations.push({
      type: "coverage",
      description:
        "No grounded AI suggestion exists in this fixture; source highlighting was not exercised.",
    });
    await expect(
      panel.getByRole("heading", { name: "Enter a field manually" }),
    ).toBeVisible();
  }

  await page.screenshot({
    path: testInfo.outputPath("m9-05-desktop.png"),
    fullPage: true,
  });

  await page.route(`**${uiExtractionPath}`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unavailable",
          message: "Local extraction is unavailable",
        },
      }),
    });
  });
  await page.reload();
  await page
    .getByRole("combobox", { name: "Evidence request" })
    .selectOption(request.id);
  const outagePanel = page.getByRole("region", {
    name: `Document fields for ${submission.fileName}`,
  });
  await expect(
    outagePanel.getByText(
      "Suggestions are unavailable. Manual review remains available.",
    ),
  ).toBeVisible();
  await expect(
    outagePanel.getByRole("button", { name: "Record manual field" }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("m9-05-outage.png"),
    fullPage: true,
  });

  const value = `M9-05 browser review ${Date.now()}`;
  await outagePanel
    .getByRole("combobox", { name: "Field" })
    .selectOption("scope");
  await outagePanel.getByRole("textbox", { name: "Value" }).fill(value);
  await outagePanel
    .getByRole("button", { name: "Record manual field" })
    .click();
  await expect(
    outagePanel.getByText("Manual field recorded without an AI citation."),
  ).toBeVisible();
  await page.unroute(`**${uiExtractionPath}`);
  await outagePanel.getByRole("button", { name: "Retry loading" }).click();
  await expect(
    outagePanel.getByText(
      "Suggestions are unavailable. Manual review remains available.",
    ),
  ).toHaveCount(0);

  const verified = await page.request.get(extractionPath);
  expect(verified.status()).toBe(200);
  const after = (await verified.json()) as Extraction;
  expect(after.suggestions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        origin: "manual",
        correctedValue: value,
        sourceSpan: null,
      }),
    ]),
  );
});

test("accepted supplier document fields fit a mobile reviewer viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsOwner(page);
  const { request, submission } = await acceptedCleanSubmission(page);
  await page.goto(`/suppliers/${request.supplierId}`);
  await page
    .getByRole("combobox", { name: "Evidence request" })
    .selectOption(request.id);
  await expect(
    page.getByRole("region", {
      name: `Document fields for ${submission.fileName}`,
    }),
  ).toBeVisible();
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll("body *"))
      .filter(
        (element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        text: element.textContent?.slice(0, 45),
      })),
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.width,
  );
  await page.screenshot({
    path: testInfo.outputPath("m9-05-mobile.png"),
    fullPage: true,
  });
});
