import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import {
  connectorResponseSchema,
  connectorFieldMapResponseSchema,
  connectorMappingSchemaResponseSchema,
  connectorMappingPreviewResponseSchema,
  fieldAuthorityImpactPreviewResponseSchema,
  fieldAuthorityPolicyResponseSchema,
  productFieldAuthorityFieldSchema,
  releaseFieldAuthorityFieldSchema,
  replaySyncRunPreviewResponseSchema,
  replaySyncRunInputSchema,
  syncRunResponseSchema,
  syncRunDetailResponseSchema,
  syncRunHistoryResponseSchema,
  syncDeadLettersResponseSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  ConnectorFieldMapping,
  SyncRunDetail,
} from "@repo/contracts/connectors/types";
import { legalEntitiesResponseSchema } from "@repo/contracts/organizations/schemas";
import { productsResponseSchema } from "@repo/contracts/products/schemas";
import {
  LIVE_API_ORIGIN,
  RunScopedAccounts,
  type TestAccount,
} from "./helpers/accounts";
/* eslint-disable turbo/no-undeclared-env-vars -- Live Playwright fixtures run outside Turbo. */
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3010";
const api = (path: string) => `${LIVE_API_ORIGIN}/api/v1${path}`;
const connectorPath = (id: string, suffix = "") => `/connectors/${id}${suffix}`;

async function parsed<T>(
  response: APIResponse,
  schema: z.ZodType<T>,
  status = 200,
): Promise<T> {
  expect(response.status()).toBe(status);
  const body: unknown = await response.json();
  expect(JSON.stringify(body)).not.toContain("m1102-secret-canary-");
  return schema.parse(body);
}

async function organization(
  context: BrowserContext,
  account: TestAccount,
  fixtures: RunScopedAccounts,
) {
  const response = await context.request.post(api("/organizations"), {
    data: {
      idempotencyKey: randomUUID(),
      legalName: `M11-02 ${randomUUID()}`,
      registeredAddress: {
        addressLine1: "12 Integration Street",
        locality: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      },
      mainEstablishmentCountry: "GB",
      manufacturerContactName: "M11-02 Fixture Owner",
      manufacturerContactEmail: account.email,
    },
  });
  expect(response.status()).toBe(201);
  const { id } = z
    .object({ id: z.uuid() })
    .passthrough()
    .parse(await response.json());
  fixtures.trackM2V2Organization(id);
  const entities = await parsed(
    await context.request.get(api("/organizations/current/legal-entities")),
    legalEntitiesResponseSchema,
  );
  const legalEntity = entities.legalEntities[0];
  if (!legalEntity)
    throw new Error("Run-owned organization requires a legal entity");
  return { id, legalEntityId: legalEntity.id };
}

async function readyConnector(
  context: BrowserContext,
  account: TestAccount,
  legalEntityId: string,
  scenario: "create" | "poison",
  canary: string,
) {
  let { connector } = await parsed(
    await context.request.post(api("/connectors"), {
      data: {
        connectorType: "reference_conformance",
        displayName: `M11-02 ${scenario} ${randomUUID()}`,
        adapterVersion: "1.0.0",
        mappingVersion: "reference-conformance-v1",
        commitPolicy: "manual",
        idempotencyKey: randomUUID(),
        connectionConfig: {
          scopeFilter: { scenario },
          defaultOwnerBinding: {
            responsibleOwnerId: account.publicUserId,
            legalEntityId,
          },
        },
      },
    }),
    connectorResponseSchema,
    201,
  );
  ({ connector } = await parsed(
    await context.request.post(api(connectorPath(connector.id, "/secret")), {
      data: {
        expectedVersion: connector.version,
        idempotencyKey: randomUUID(),
        secretValue: canary,
      },
    }),
    connectorResponseSchema,
  ));
  ({ connector } = await parsed(
    await context.request.post(api(connectorPath(connector.id, "/test")), {
      data: {
        expectedVersion: connector.version,
        idempotencyKey: randomUUID(),
      },
    }),
    connectorResponseSchema,
  ));
  expect(connector.lastTestOutcome).toBe("success");
  for (const entityType of ["product", "release"] as const) {
    const fields =
      entityType === "product"
        ? productFieldAuthorityFieldSchema.options
        : releaseFieldAuthorityFieldSchema.options;
    for (const fieldName of fields) {
      const body = {
        entityType,
        fieldName,
        policyValue: "external_authoritative",
        protected: false,
      };
      const { preview } = await parsed(
        await context.request.post(
          api(connectorPath(connector.id, "/mapping/preview")),
          { data: body },
        ),
        fieldAuthorityImpactPreviewResponseSchema,
      );
      await parsed(
        await context.request.post(
          api(connectorPath(connector.id, "/mapping")),
          { data: { ...body, previewDigest: preview.previewDigest } },
        ),
        fieldAuthorityPolicyResponseSchema,
      );
    }
  }
  return connector;
}

async function detail(
  context: BrowserContext,
  connectorId: string,
  runId: string,
) {
  return parsed(
    await context.request.get(
      api(
        connectorPath(
          connectorId,
          `/sync-runs/${runId}/history?page=1&pageSize=100`,
        ),
      ),
    ),
    syncRunDetailResponseSchema,
  );
}

async function waitForRun(
  context: BrowserContext,
  connectorId: string,
  runId: string,
  status: string,
): Promise<SyncRunDetail> {
  let result: SyncRunDetail | undefined;
  await expect
    .poll(
      async () => {
        result = await detail(context, connectorId, runId);
        return result.run.run.status;
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(status);
  if (!result) throw new Error("Run history did not return a parsed result");
  return result;
}

async function clickResponse(
  page: Page,
  label: string,
  path: string,
  method = "POST",
) {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === `/api/v1${path}` &&
      candidate.request().method() === method,
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  return response;
}
const productMappings: ConnectorFieldMapping[] = [
  "name",
  "internalCode",
  "productType",
  "description",
].map((field) => ({
  entityType: "product",
  sourceField: field,
  targetField: field,
  transform: "identity",
}));
// One run-owned journey exercises UI commands against real API/worker/database boundaries.
// Cleanup uses only tracked organizations/users; no site storage, inbox, or database reset.
test("M11-02 owner reviews typed mappings, atomic history and permissioned dead-letter replay", async ({
  browser,
}, testInfo) => {
  test.setTimeout(600_000);
  expect(
    new URL(LIVE_API_ORIGIN).hostname,
    "Set E2E_API_ORIGIN and E2E_WEB_ORIGIN to the same hostname for session cookies",
  ).toBe(new URL(WEB_ORIGIN).hostname);
  const fixtures = new RunScopedAccounts(testInfo);
  const contexts: BrowserContext[] = [];
  const canary = `m1102-secret-canary-${randomUUID()}`;
  let journeyFailure: unknown;
  let cleanupFailure: unknown;
  try {
    const context = await browser.newContext({
      baseURL: WEB_ORIGIN,
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    contexts.push(context);
    const owner = await fixtures.createVerified(context, "m1102-owner");
    const tenant = await organization(context, owner, fixtures);
    const connector = await readyConnector(
      context,
      owner,
      tenant.legalEntityId,
      "create",
      canary,
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(`/connectors/${connector.id}`);
    await expect(
      page.getByRole("heading", { name: "Source field mapping", exact: true }),
    ).toBeVisible();
    const { schema } = await parsed(
      await context.request.get(
        api(connectorPath(connector.id, "/field-mapping/schema")),
      ),
      connectorMappingSchemaResponseSchema,
    );
    expect(
      schema.sources
        .find((source) => source.entityType === "product")
        ?.fields.find((field) => field.field === "description"),
    ).toMatchObject({ type: "string", required: false, sensitive: false });
    expect(
      schema.targets
        .flatMap((target) => target.fields)
        .some((field) => field.field === "organizationId"),
    ).toBe(false);

    for (const [index, field] of productMappings.entries()) {
      const mappingButton = page.getByRole("button", {
        name: `Map product.${field.targetField}${field.targetField === "description" ? "" : " (required)"}`,
        exact: true,
      });
      await mappingButton.focus();
      await expect(mappingButton).toBeFocused();
      await page.keyboard.press("Enter");
      await page
        .getByRole("combobox", {
          name: `Source field ${index + 1}`,
          exact: true,
        })
        .selectOption(field.sourceField);
    }
    const previewResponse = await clickResponse(
      page,
      "Preview field mapping",
      connectorPath(connector.id, "/field-mapping/preview"),
    );
    const previewBody: unknown = await previewResponse.json();
    const safeError = z
      .object({ code: z.string() })
      .passthrough()
      .safeParse(previewBody);
    expect(
      previewResponse.status(),
      safeError.success ? safeError.data.code : "Field mapping preview",
    ).toBe(200);
    const preview =
      connectorMappingPreviewResponseSchema.parse(previewBody).preview;
    expect(preview.valid).toBe(true);
    expect(preview.samples[0]?.fields.name).toBe("Sentinel Gateway");
    expect(JSON.stringify(preview)).not.toContain(canary);
    await expect(
      page.getByText("Mapping preview is valid.", { exact: true }),
    ).toBeVisible();
    const savedResponse = await clickResponse(
      page,
      "Save field mapping",
      connectorPath(connector.id, "/field-mapping"),
    );
    expect(savedResponse.status()).toBe(200);
    const mapping = connectorFieldMapResponseSchema.parse(
      await savedResponse.json(),
    ).mapping;
    expect(mapping.fields).toEqual(productMappings);
    expect(mapping.revision).toBeGreaterThan(0);

    for (const [sourceField, targetField, code] of [
      ["renamedName", "name", "unknown_source"],
      ["name", "organizationId", "protected_target"],
      ["fixtureCredential", "name", "sensitive_source"],
    ] as const) {
      const invalid = await parsed(
        await context.request.post(
          api(connectorPath(connector.id, "/field-mapping/preview")),
          {
            data: {
              fields: [
                {
                  entityType: "product",
                  sourceField,
                  targetField,
                  transform: "identity",
                },
              ],
            },
          },
        ),
        connectorMappingPreviewResponseSchema,
      );
      expect(invalid.preview.valid).toBe(false);
      expect(invalid.preview.issues.some((issue) => issue.code === code)).toBe(
        true,
      );
    }
    const current = await parsed(
      await context.request.get(api(connectorPath(connector.id))),
      connectorResponseSchema,
    );
    const staleSave = await context.request.post(
      api(connectorPath(connector.id, "/field-mapping")),
      {
        data: {
          fields: productMappings,
          schemaDigest: schema.schemaDigest,
          expectedVersion: current.connector.version,
          expectedMappingRevision: mapping.revision - 1,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(staleSave.status()).toBe(409);

    const beginResponse = await clickResponse(
      page,
      "Start dry run (incremental)",
      connectorPath(connector.id, "/sync-runs"),
    );
    expect(beginResponse.status()).toBe(202);
    const initial = syncRunResponseSchema.parse(await beginResponse.json()).run;
    const planned = await waitForRun(
      context,
      connector.id,
      initial.id,
      "waiting_for_review",
    );
    expect(planned.run.fieldMappingRevision).toBe(mapping.revision);
    expect(planned.run.counts).toEqual({
      succeeded: 0,
      skipped: 0,
      failed: 0,
      pending: 1,
    });
    await expect(
      page.getByRole("button", { name: "Request commit", exact: true }),
    ).toBeEnabled();
    const requested = await clickResponse(
      page,
      "Request commit",
      connectorPath(connector.id, `/sync-runs/${initial.id}/request-commit`),
    );
    expect(requested.status()).toBe(200);
    const committed = await waitForRun(
      context,
      connector.id,
      initial.id,
      "completed",
    );
    expect(committed.run.counts).toEqual({
      succeeded: 1,
      skipped: 0,
      failed: 0,
      pending: 0,
    });
    expect(committed.run.startedAt).not.toBeNull();
    expect(committed.run.finishedAt).not.toBeNull();
    expect(committed.attempts.rows.map((attempt) => attempt.phase)).toEqual(
      expect.arrayContaining(["dry_run", "commit"]),
    );
    expect(committed.records.rows[0]).toMatchObject({
      outcome: "succeeded",
      errorCode: null,
    });
    expect(committed.records.rows[0]?.appliedAt).not.toBeNull();
    await expect(
      page.getByRole("heading", { name: "Sync history", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^View run details / })
      .first()
      .click();
    await expect(
      page.getByRole("table", { name: "Attempts", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Record outcomes", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m11-02-history-desktop.png"),
      fullPage: true,
    });
    const history = await parsed(
      await context.request.get(
        api(connectorPath(connector.id, "/sync-history?page=1&pageSize=1")),
      ),
      syncRunHistoryResponseSchema,
    );
    expect(history.runs.rows).toHaveLength(1);
    const products = await parsed(
      await context.request.get(api("/products?page=1&pageSize=100")),
      productsResponseSchema,
    );
    expect(
      products.products.rows.filter(
        (product) => product.name === "Sentinel Gateway",
      ),
    ).toHaveLength(1);

    const poison = await readyConnector(
      context,
      owner,
      tenant.legalEntityId,
      "poison",
      canary,
    );
    await page.goto(`/connectors/${poison.id}`);
    const poisonStarted = await clickResponse(
      page,
      "Start dry run (incremental)",
      connectorPath(poison.id, "/sync-runs"),
    );
    expect(poisonStarted.status()).toBe(202);
    const poisonedRun = syncRunResponseSchema.parse(
      await poisonStarted.json(),
    ).run;
    const failed = await waitForRun(
      context,
      poison.id,
      poisonedRun.id,
      "failed",
    );
    expect(failed.run.counts.failed).toBe(1);
    expect(
      failed.run.counts.pending +
        failed.run.counts.skipped +
        failed.run.counts.failed +
        failed.run.counts.succeeded,
    ).toBe(failed.run.run.rowCount);
    const letters = await parsed(
      await context.request.get(
        api(
          connectorPath(poison.id, "/dead-letter-records?page=1&pageSize=100"),
        ),
      ),
      syncDeadLettersResponseSchema,
    );
    expect(letters.records.rows).toHaveLength(1);
    expect(letters.records.rows[0]).toMatchObject({
      runId: poisonedRun.id,
      outcome: "failed",
      errorCategory: "invalid_data",
    });
    expect(letters.records.rows[0]?.deadLetteredAt).not.toBeNull();
    const legacyRetry = await context.request.post(
      api(connectorPath(poison.id, `/sync-runs/${poisonedRun.id}/retry`)),
      { data: {} },
    );
    expect(legacyRetry.status()).toBe(409);
    const bypass = await context.request.post(
      api(connectorPath(poison.id, "/sync-runs")),
      {
        data: {
          reconciliationKind: "incremental",
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(bypass.status()).toBe(409);
    const staleReplay = await context.request.post(
      api(
        connectorPath(poison.id, `/sync-runs/${poisonedRun.id}/replay/preview`),
      ),
      {
        data: {
          expectedVersion: Math.max(0, failed.run.version - 1),
          mappingMode: "preserve",
          sourceMode: "retained",
        },
      },
    );
    expect(staleReplay.status()).toBe(409);

    await expect(
      page.getByRole("button", { name: /^Review replay for / }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Review replay for / }).click();
    await page
      .getByLabel("Replay reason", { exact: true })
      .fill("Inspect retained failed source without applying domain effects");
    await expect(
      page.getByRole("button", {
        name: "Request reviewed replay",
        exact: true,
      }),
    ).toBeDisabled();
    const replayPreviewResponse = await clickResponse(
      page,
      "Preview replay",
      connectorPath(poison.id, `/sync-runs/${poisonedRun.id}/replay/preview`),
    );
    expect(replayPreviewResponse.status()).toBe(200);
    const replayPreview = replaySyncRunPreviewResponseSchema.parse(
      await replayPreviewResponse.json(),
    ).preview;
    expect(replayPreview.mappingMode).toBe("preserve");
    expect(replayPreview.sourceMode).toBe("retained");
    expect(JSON.stringify(replayPreview)).not.toContain(canary);
    await page
      .getByRole("combobox", { name: "Mapping version", exact: true })
      .selectOption("rebase");
    await expect(
      page.getByRole("button", {
        name: "Request reviewed replay",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("combobox", { name: "Source records", exact: true })
      .selectOption("refetch");
    const poisonCurrent = await parsed(
      await context.request.get(api(connectorPath(poison.id))),
      connectorResponseSchema,
    );
    const repairedConfig = {
      scopeFilter: { scenario: "repaired" },
      defaultOwnerBinding: {
        responsibleOwnerId: owner.publicUserId,
        legalEntityId: tenant.legalEntityId,
      },
    };
    const repaired = await parsed(
      await context.request.patch(api(connectorPath(poison.id)), {
        data: {
          displayName: poisonCurrent.connector.displayName,
          mappingVersion: poisonCurrent.connector.mappingVersion,
          commitPolicy: poisonCurrent.connector.commitPolicy,
          connectionConfig: repairedConfig,
          expectedVersion: poisonCurrent.connector.version,
          idempotencyKey: randomUUID(),
        },
      }),
      connectorResponseSchema,
    );
    await parsed(
      await context.request.post(api(connectorPath(poison.id, "/test")), {
        data: {
          expectedVersion: repaired.connector.version,
          idempotencyKey: randomUUID(),
        },
      }),
      connectorResponseSchema,
    );
    const refetchResponse = await clickResponse(
      page,
      "Preview replay",
      connectorPath(poison.id, `/sync-runs/${poisonedRun.id}/replay/preview`),
    );
    const refetchPreview = replaySyncRunPreviewResponseSchema.parse(
      await refetchResponse.json(),
    ).preview;
    expect(refetchResponse.status()).toBe(200);
    expect(refetchPreview).toMatchObject({
      mappingMode: "rebase",
      sourceMode: "refetch",
      canReplay: true,
    });
    const replayRequested = await clickResponse(
      page,
      "Request reviewed replay",
      connectorPath(poison.id, `/sync-runs/${poisonedRun.id}/replay`),
    );
    expect(replayRequested.status()).toBe(200);
    const child = syncRunResponseSchema.parse(await replayRequested.json()).run;
    expect(child.id).not.toBe(poisonedRun.id);
    const replayInput = replaySyncRunInputSchema.parse(
      replayRequested.request().postDataJSON(),
    );
    const duplicated = await parsed(
      await context.request.post(
        api(connectorPath(poison.id, `/sync-runs/${poisonedRun.id}/replay`)),
        { data: replayInput },
      ),
      syncRunResponseSchema,
      200,
    );
    expect(duplicated.run.id).toBe(child.id);
    const changedRetry = await context.request.post(
      api(connectorPath(poison.id, `/sync-runs/${poisonedRun.id}/replay`)),
      {
        data: {
          ...replayInput,
          reason: "Different command body must conflict",
        },
      },
    );
    expect(changedRetry.status()).toBe(409);

    const childReviewed = await waitForRun(
      context,
      poison.id,
      child.id,
      "waiting_for_review",
    );
    expect(childReviewed.run.replayOfRunId).toBe(poisonedRun.id);
    expect(childReviewed.run.run.committedAt).toBeNull();
    const childCommit = await context.request.post(
      api(connectorPath(poison.id, `/sync-runs/${child.id}/request-commit`)),
      { data: { expectedRowCount: childReviewed.run.run.rowCount } },
    );
    expect(childCommit.status()).toBe(200);
    const childCompleted = await waitForRun(
      context,
      poison.id,
      child.id,
      "completed",
    );
    expect(childCompleted.run.counts).toEqual({
      succeeded: 2,
      skipped: 0,
      failed: 0,
      pending: 0,
    });
    expect(
      (await detail(context, poison.id, poisonedRun.id)).run.run.status,
    ).toBe("failed");
    const resolvedLetters = await parsed(
      await context.request.get(
        api(
          connectorPath(poison.id, "/dead-letter-records?page=1&pageSize=100"),
        ),
      ),
      syncDeadLettersResponseSchema,
    );
    expect(resolvedLetters.records.total).toBe(0);

    await expect(
      page.getByText("No failed sync records.", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("m11-02-dead-letters-mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await testInfo.attach("browser-version", {
      body: `${testInfo.project.name}: ${browser.version()}; reduced motion enabled`,
      contentType: "text/plain",
    });

    const viewerContext = await browser.newContext({ baseURL: WEB_ORIGIN });
    contexts.push(viewerContext);
    const viewer = await fixtures.createVerified(viewerContext, "m1102-viewer");
    const invitation = await context.request.post(api("/invitations"), {
      data: { email: viewer.email, role: "viewer" },
    });
    expect(invitation.status()).toBe(201);
    const { id: invitationId } = z
      .object({ id: z.uuid() })
      .passthrough()
      .parse(await invitation.json());
    fixtures.trackInvitation(invitationId);
    expect(
      (
        await viewerContext.request.post(api("/invitations/accept"), {
          data: { token: await fixtures.invitationToken(viewer.email) },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await viewerContext.request.get(
          api(connectorPath(poison.id, "/sync-history")),
        )
      ).status(),
    ).toBe(200);
    for (const [suffix, data] of [
      ["/field-mapping/preview", { fields: productMappings }],
      [
        `/sync-runs/${poisonedRun.id}/replay/preview`,
        {
          expectedVersion: failed.run.version,
          mappingMode: "preserve",
          sourceMode: "retained",
        },
      ],
    ] as const) {
      expect(
        (
          await viewerContext.request.post(
            api(connectorPath(poison.id, suffix)),
            { data },
          )
        ).status(),
      ).toBe(403);
    }
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`/connectors/${poison.id}`);
    await expect(
      viewerPage.getByRole("button", { name: /^Review replay for / }),
    ).toHaveCount(0);

    const otherContext = await browser.newContext({ baseURL: WEB_ORIGIN });
    contexts.push(otherContext);
    const other = await fixtures.createVerified(otherContext, "m1102-other");
    await organization(otherContext, other, fixtures);
    for (const suffix of [
      "/field-mapping/schema",
      "/sync-history",
      "/dead-letter-records",
      `/sync-runs/${poisonedRun.id}/history`,
    ]) {
      const hidden = await otherContext.request.get(
        api(connectorPath(poison.id, suffix)),
      );
      expect(hidden.status()).toBe(404);
      expect(await hidden.text()).not.toContain(poison.displayName);
    }
  } catch (error) {
    journeyFailure = error;
  } finally {
    const closed = await Promise.allSettled(
      contexts.map((context) => context.close()),
    );
    try {
      await fixtures.cleanup();
    } catch (error) {
      cleanupFailure = error;
    }
    const closeFailure = closed.find((result) => result.status === "rejected");
    if (!cleanupFailure && closeFailure?.status === "rejected")
      cleanupFailure = closeFailure.reason;
    if (cleanupFailure)
      await testInfo.attach("scoped-cleanup-failure", {
        body: String(cleanupFailure),
        contentType: "text/plain",
      });
  }
  if (journeyFailure) throw journeyFailure;
  if (cleanupFailure) throw cleanupFailure;
});
