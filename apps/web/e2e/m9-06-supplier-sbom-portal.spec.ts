import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { LIVE_API_ORIGIN, signIn } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- This opt-in live browser test runs outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const MAILPIT_ORIGIN =
  process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const API = `${LIVE_API_ORIGIN}/api/v1`;
const execFileAsync = promisify(execFile);
const requestedBrowser = process.env.M906_BROWSER;

if (
  requestedBrowser &&
  requestedBrowser !== "chromium" &&
  requestedBrowser !== "firefox" &&
  requestedBrowser !== "webkit"
) {
  throw new Error("M906_BROWSER must be chromium, firefox, or webkit");
}

const browserName =
  requestedBrowser === "firefox" || requestedBrowser === "webkit"
    ? requestedBrowser
    : "chromium";

test.use({ browserName });

type Session = { user: { id: string } };
type LegalEntities = {
  legalEntities: Array<{
    id: string;
    identifier: string | null;
    status: string;
    completionStatus: string;
  }>;
};
type IdResponse<T extends string> = Record<T, { id: string }>;
type EvidenceRequest = {
  request: {
    id: string;
    version: number;
    currentRevision: { id: string };
    activeInvitation: { id: string } | null;
  };
};
type SupplierSubmission = {
  id: string;
  sourceId: string | null;
  state: string;
};

function assertLocalOrigins(): void {
  for (const origin of [WEB_ORIGIN, LIVE_API_ORIGIN, MAILPIT_ORIGIN]) {
    const host = new URL(origin).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new Error(
        `M9-06 browser test refuses a non-local origin: ${origin}`,
      );
    }
  }
}

async function json<T>(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
  expected: number,
): Promise<T> {
  const body = await response.text();
  expect(response.status(), body).toBe(expected);
  return JSON.parse(body) as T;
}

async function ownerIdentity(request: APIRequestContext) {
  const session = await json<Session>(
    await request.get(`${API}/auth/session`),
    200,
  );
  const entities = await json<LegalEntities>(
    await request.get(`${API}/organizations/current/legal-entities`),
    200,
  );
  const legalEntity = entities.legalEntities.find(
    (candidate) =>
      candidate.identifier === "default" &&
      candidate.status === "active" &&
      candidate.completionStatus === "complete",
  );
  if (!legalEntity)
    throw new Error("Local owner fixture lacks a default legal entity");
  return { ownerId: session.user.id, legalEntityId: legalEntity.id };
}

async function issuedFixture(request: APIRequestContext, runId: string) {
  const { ownerId, legalEntityId } = await ownerIdentity(request);
  const supplierName = `M9-06 supplier ${runId}`;
  const contactEmail = `m906-${runId}@cra.test`;
  const supplier = await json<IdResponse<"supplier">>(
    await request.post(`${API}/suppliers`, {
      data: {
        name: supplierName,
        criticality: "medium",
        duplicateCandidateIdsConfirmed: [],
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  const contact = await json<IdResponse<"contact">>(
    await request.post(`${API}/suppliers/${supplier.supplier.id}/contacts`, {
      data: {
        name: "M9-06 supplier contact",
        email: contactEmail,
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  const product = await json<IdResponse<"product">>(
    await request.post(`${API}/products`, {
      data: {
        name: `M9-06 product ${runId}`,
        internalCode: `M906-${runId}`,
        productType: "standalone_software",
        responsibleOwnerId: ownerId,
        legalEntityId,
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  const release = await json<IdResponse<"release">>(
    await request.post(`${API}/products/${product.product.id}/releases`, {
      data: {
        label: `M9-06 release ${runId}`,
        version: "1.0.0",
        idempotencyKey: randomUUID(),
      },
    }),
    201,
  );
  const componentRef = `pkg:npm/m906-${runId}@1.0.0`;
  const expiresAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
  const m3 = await json<IdResponse<"request">>(
    await request.post(
      `${API}/products/${product.product.id}/releases/${release.release.id}/supplier-sbom-requests`,
      {
        data: {
          productId: product.product.id,
          releaseId: release.release.id,
          supplierDisplayName: supplierName,
          allowedComponentRef: componentRef,
          expiresAt,
          idempotencyKey: randomUUID(),
        },
      },
    ),
    201,
  );
  await json(
    await request.post(
      `${API}/suppliers/${supplier.supplier.id}/requests/${m3.request.id}`,
      { data: { idempotencyKey: randomUUID() } },
    ),
    201,
  );
  const draft = {
    supplierId: supplier.supplier.id,
    productId: product.product.id,
    recipientContactId: contact.contact.id,
    ownerUserId: ownerId,
    title: `Supply component SBOM ${runId}`,
    instructions: "Submit the assigned component SBOM for internal review.",
    dueAt: expiresAt,
    items: [
      {
        title: "Component SBOM",
        kind: "sbom",
        documentClass: "sbom",
        supplierSbomRequestId: m3.request.id,
      },
    ],
  };
  const preview = await json<{
    preview: { fingerprint: string };
  }>(
    await request.post(`${API}/supplier-evidence-requests/preview`, {
      data: draft,
    }),
    201,
  );
  const created = await json<EvidenceRequest>(
    await request.post(`${API}/supplier-evidence-requests`, {
      data: { ...draft, idempotencyKey: randomUUID() },
    }),
    201,
  );
  const issued = await json<EvidenceRequest>(
    await request.post(
      `${API}/supplier-evidence-requests/${created.request.id}/issue`,
      {
        data: {
          revisionId: created.request.currentRevision.id,
          expectedVersion: created.request.version,
          previewFingerprint: preview.preview.fingerprint,
          idempotencyKey: randomUUID(),
        },
      },
    ),
    201,
  );
  return {
    contactEmail,
    componentRef,
    m3RequestId: m3.request.id,
    m9RequestId: issued.request.id,
    productId: product.product.id,
    supplierId: supplier.supplier.id,
    title: draft.title,
  };
}

async function invitationLink(email: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const list = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages?limit=100`);
    if (list.ok) {
      const payload = (await list.json()) as {
        messages?: Array<{ ID?: string; Id?: string }>;
      };
      for (const candidate of payload.messages ?? []) {
        const id = candidate.ID ?? candidate.Id;
        if (!id) continue;
        const detail = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${id}`);
        if (!detail.ok) continue;
        const message = (await detail.json()) as {
          To?: Array<{ Address?: string }>;
          Text?: string;
          HTML?: string;
        };
        if (
          !message.To?.some(({ Address }) => Address?.toLowerCase() === email)
        )
          continue;
        const match =
          /https?:\/\/[^\s<>"']+\/supplier-evidence#[A-Za-z0-9_%.-]+/u.exec(
            `${message.Text ?? ""}\n${message.HTML ?? ""}`,
          );
        if (match) return match[0];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No M9 supplier invitation arrived in local Mailpit for ${email}`,
  );
}

function sbomBytes(componentRef: string, valid: boolean): Buffer {
  return Buffer.from(
    `${JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      version: 1,
      components: [
        {
          type: "library",
          "bom-ref": componentRef,
          ...(valid ? { name: "m906-component", version: "1.0.0" } : {}),
          purl: componentRef,
        },
      ],
    })}\n`,
    "utf8",
  );
}

async function runWorkerOnce(): Promise<void> {
  const result = await execFileAsync(
    "pnpm",
    [
      "--filter",
      "api",
      "exec",
      "ts-node",
      "-r",
      "tsconfig-paths/register",
      "src/sbom-ingest-worker.ts",
      "--once",
    ],
    { cwd: REPO_ROOT, env: process.env, timeout: 60_000 },
  );
  expect(result.stderr).not.toContain("SBOM ingest worker cycle failed safely");
}

async function supplierSubmission(
  request: APIRequestContext,
  requestId: string,
  productId: string,
): Promise<SupplierSubmission> {
  const response = await json<{
    requests: Array<{
      request: { id: string };
      submissions: SupplierSubmission[];
    }>;
  }>(
    await request.get(
      `${API}/supplier-sbom-requests?productId=${productId}&limit=100`,
    ),
    200,
  );
  const summary = response.requests.find((row) => row.request.id === requestId);
  const pending = summary?.submissions.find(
    (submission) => submission.state === "awaiting_review",
  );
  if (!pending)
    throw new Error("Linked M3 submission is not visible to the owner");
  return pending;
}

test("assigned supplier uploads, corrects, and reviews an SBOM through the M9 link", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  assertLocalOrigins();
  expect(browser.browserType().name()).toBe(browserName);
  const runId = `${Date.now()}-${testInfo.parallelIndex}`;
  const owner = await browser.newContext({ baseURL: WEB_ORIGIN });
  const supplier = await browser.newContext({ baseURL: WEB_ORIGIN });
  try {
    expect((await signIn(owner.request, "owner@cra.test")).status()).toBe(200);
    const fixture = await issuedFixture(owner.request, runId);
    const invitation = new URL(await invitationLink(fixture.contactEmail));
    const link = `${WEB_ORIGIN}/supplier-evidence${invitation.hash}`;
    const page = await supplier.newPage();
    const opened = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/v1/supplier-evidence-portal/sessions" &&
        response.request().method() === "POST",
    );
    await page.goto(link);
    const openedResponse = await opened;
    expect(openedResponse.status()).toBe(201);
    const portalPayload = JSON.stringify(await openedResponse.json());
    expect(portalPayload).not.toContain('"organizationId"');
    expect(portalPayload).not.toContain('"productId"');
    expect(portalPayload).not.toContain('"findings"');
    await expect(
      page.getByRole("heading", { name: fixture.title }),
    ).toBeVisible();
    await expect(
      page.getByText(`Allowed component: ${fixture.componentRef}`),
    ).toBeVisible();
    await expect(page.getByText("No SBOM submitted yet.")).toBeVisible();
    await expect(
      page.getByText(/100 MiB maximum.*does not accept a product baseline/u),
    ).toBeVisible();
    await page.getByLabel("SBOM file").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Declared format (optional)")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByLabel("Specification version (optional)"),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath("m9-06-supplier-desktop.png"),
      fullPage: true,
    });

    await page.getByLabel("SBOM file").setInputFiles({
      name: `m906-invalid-${runId}.cdx.json`,
      mimeType: "application/json",
      buffer: sbomBytes(fixture.componentRef, false),
    });
    const invalidCompletion = page.waitForResponse((response) =>
      /\/supplier-evidence-portal\/sbom-items\/[^/]+\/submissions\/[^/]+\/complete$/u.test(
        new URL(response.url()).pathname,
      ),
    );
    await page.getByRole("button", { name: "Upload SBOM" }).focus();
    await expect(
      page.getByRole("button", { name: "Upload SBOM" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    expect((await invalidCompletion).status()).toBe(202);
    await runWorkerOnce();
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: /Validation failed; a corrected file may be submitted/u,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: testInfo.outputPath("m9-06-validation-failed.png"),
      fullPage: true,
    });

    await page.getByLabel("SBOM file").setInputFiles({
      name: `m906-corrected-${runId}.cdx.json`,
      mimeType: "application/json",
      buffer: sbomBytes(fixture.componentRef, true),
    });
    const completed = page.waitForResponse((response) =>
      /\/supplier-evidence-portal\/sbom-items\/[^/]+\/submissions\/[^/]+\/complete$/u.test(
        new URL(response.url()).pathname,
      ),
    );
    await page.getByRole("button", { name: "Upload SBOM" }).click();
    expect((await completed).status()).toBe(202);
    await runWorkerOnce();
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: /Awaiting internal SBOM review/u,
      }),
    ).toBeVisible({ timeout: 30_000 });

    const pending = await supplierSubmission(
      owner.request,
      fixture.m3RequestId,
      fixture.productId,
    );
    expect(pending.state).toBe("awaiting_review");
    expect(pending.sourceId).not.toBeNull();
    await json(
      await owner.request.post(
        `${API}/supplier-sbom-submissions/${pending.id}/review`,
        {
          data: {
            decision: "accept",
            reason:
              "Component identity and normalized evidence verified in local E2E review.",
            idempotencyKey: randomUUID(),
          },
        },
      ),
      201,
    );
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByText(/Accepted by an authorized SBOM reviewer/u),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("heading", { name: fixture.title }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("m9-06-supplier-mobile.png"),
      fullPage: true,
    });

    const current = await json<EvidenceRequest>(
      await owner.request.get(
        `${API}/supplier-evidence-requests/${fixture.m9RequestId}`,
      ),
      200,
    );
    if (!current.request.activeInvitation)
      throw new Error("M9 invitation unexpectedly missing");
    await json(
      await owner.request.post(
        `${API}/supplier-evidence-requests/${fixture.m9RequestId}/revoke`,
        {
          data: {
            invitationId: current.request.activeInvitation.id,
            reason: "Local E2E revocation check",
            expectedVersion: current.request.version,
            idempotencyKey: randomUUID(),
          },
        },
      ),
      201,
    );
    const deniedRequest = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/v1/supplier-evidence-portal/request" &&
        response.request().method() === "GET",
    );
    await page.reload();
    const deniedResponse = await deniedRequest;
    expect(deniedResponse.status(), await deniedResponse.text()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "This supplier link is unavailable" }),
    ).toBeVisible();
    await expect(page.locator("main p[role='alert']")).toContainText(
      "expired, revoked, or no longer available",
    );
    await page.screenshot({
      path: testInfo.outputPath("m9-06-revoked.png"),
      fullPage: true,
    });
  } finally {
    await supplier.close();
    await owner.close();
  }
});
