import { randomUUID } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  type APIResponse,
  type BrowserContext,
  type Page,
  type Response as BrowserResponse,
} from "@playwright/test";
import { z } from "zod";
import * as schemas from "@repo/contracts/connectors/schemas";
import { legalEntitiesResponseSchema } from "@repo/contracts/organizations/schemas";
import {
  productResponseSchema,
  releaseResponseSchema,
} from "@repo/contracts/products/schemas";
import {
  LIVE_API_ORIGIN,
  RunScopedAccounts,
  type TestAccount,
} from "./helpers/accounts";
/* eslint-disable turbo/no-undeclared-env-vars -- Live fixtures run outside Turbo. */
export const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3011";
const controlOrigin =
  process.env.M1103_CONTROL_ORIGIN ?? "http://127.0.0.1:3340";
export const api = (path: string) => `${LIVE_API_ORIGIN}/api/v1${path}`;
export const endpointPath = (id: string, suffix = "") =>
  `/connectors/webhooks/${id}${suffix}`;
export const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const captureSchema = z
  .object({
    eventId: schemas.webhookEventIdSchema,
    deliveryId: z.uuid(),
    timestamp: z.string(),
    body: z.string(),
    sha256: z.string(),
    verifiedKeyIds: z.array(z.uuid()),
    status: z.number(),
  })
  .strict();
export const stateSchema = z
  .object({
    captures: z.array(captureSchema),
    workerActive: z.boolean(),
    tickFailure: z.boolean(),
    organizationId: z.uuid().nullable(),
  })
  .strict();
export type Keys = readonly Readonly<{ keyId: string; secret: string }>[];

export async function control(path: string, data?: unknown) {
  const token = process.env.M1103_CONTROL_TOKEN;
  if (!token || token.length < 32)
    throw new Error(
      "Run the isolated M11-03 fixture with the same ephemeral M1103_CONTROL_TOKEN",
    );
  const response = await fetch(`${controlOrigin}${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  expect(response.status, "Scoped fixture control").toBe(200);
  return (await response.json()) as unknown;
}
export async function parsed<T>(
  response: APIResponse | BrowserResponse,
  schema: z.ZodType<T>,
  secrets: readonly string[],
  status = 200,
): Promise<T> {
  expect(response.status()).toBe(status);
  const body: unknown = await response.json();
  for (const secret of [...secrets, "m1103-receiver-body-canary-do-not-store"])
    expect(JSON.stringify(body)).not.toContain(secret);
  return schema.parse(body);
}
export async function command(
  page: Page,
  label: string,
  path: string,
  method = "POST",
) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1${path}` &&
      response.request().method() === method,
  );
  const button = page.getByRole("button", { name: label, exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  return pending;
}
export async function tenant(
  context: BrowserContext,
  owner: TestAccount,
  fixtures: RunScopedAccounts,
) {
  const response = await context.request.post(api("/organizations"), {
    data: {
      idempotencyKey: randomUUID(),
      legalName: `M11-03 ${randomUUID()}`,
      registeredAddress: {
        addressLine1: "13 Integration Street",
        locality: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      },
      mainEstablishmentCountry: "GB",
      manufacturerContactName: "M11-03 Fixture Owner",
      manufacturerContactEmail: owner.email,
    },
  });
  expect(response.status()).toBe(201);
  const organizationId = z
    .object({ id: z.uuid() })
    .passthrough()
    .parse(await response.json()).id;
  fixtures.trackM2V2Organization(organizationId);
  const entities = await parsed(
    await context.request.get(api("/organizations/current/legal-entities")),
    legalEntitiesResponseSchema,
    [],
  );
  const legalEntity = entities.legalEntities[0];
  if (!legalEntity) throw new Error("Fixture legal entity missing");
  const { product } = await parsed(
    await context.request.post(api("/products"), {
      data: {
        name: "M11-03 receiver scope",
        internalCode: `M1103-${randomUUID()}`,
        productType: "standalone_software",
        responsibleOwnerId: owner.publicUserId,
        legalEntityId: legalEntity.id,
        idempotencyKey: randomUUID(),
      },
    }),
    productResponseSchema,
    [],
    201,
  );
  const { release } = await parsed(
    await context.request.post(api(`/products/${product.id}/releases`), {
      data: {
        label: "Webhook fixture release",
        version: "1.0.0",
        idempotencyKey: randomUUID(),
      },
    }),
    releaseResponseSchema,
    [],
    201,
  );
  return { organizationId, productId: product.id, releaseId: release.id };
}
export async function delivery(
  context: BrowserContext,
  endpointId: string,
  id: string,
  secrets: readonly string[],
) {
  return (
    await parsed(
      await context.request.get(
        api(endpointPath(endpointId, `/deliveries/${id}?page=1&pageSize=100`)),
      ),
      schemas.webhookDeliveryDetailResponseSchema,
      secrets,
    )
  ).detail;
}
export async function newest(
  context: BrowserContext,
  endpointId: string,
  secrets: readonly string[],
) {
  return (
    await parsed(
      await context.request.get(
        api(endpointPath(endpointId, "/deliveries?page=1&pageSize=100")),
      ),
      schemas.webhookDeliveriesResponseSchema,
      secrets,
    )
  ).deliveries.rows;
}
export async function waitDelivery(
  context: BrowserContext,
  endpointId: string,
  id: string,
  status: string,
  secrets: readonly string[],
) {
  let current: Awaited<ReturnType<typeof delivery>> | undefined;
  await expect
    .poll(
      async () => {
        current = await delivery(context, endpointId, id, secrets);
        return current.delivery.status;
      },
      { timeout: 90_000, intervals: [1100, 2000, 3000] },
    )
    .toBe(status);
  if (!current) throw new Error("Delivery missing");
  return current;
}
export async function invite(
  owner: BrowserContext,
  member: BrowserContext,
  account: TestAccount,
  fixtures: RunScopedAccounts,
  role: "viewer" | "admin",
) {
  const response = await owner.request.post(api("/invitations"), {
    data: { email: account.email, role },
  });
  expect(response.status()).toBe(201);
  const invitation = z
    .object({ id: z.uuid() })
    .passthrough()
    .parse(await response.json());
  fixtures.trackInvitation(invitation.id);
  expect(
    (
      await member.request.post(api("/invitations/accept"), {
        data: { token: await fixtures.invitationToken(account.email) },
      })
    ).status(),
  ).toBe(200);
}

export async function checkActorRevocation(
  owner: BrowserContext,
  admin: BrowserContext,
  account: TestAccount,
  fixtures: RunScopedAccounts,
  endpointId: string,
  scope: { organizationId: string; productId: string; releaseId: string },
  keys: Keys,
  secrets: readonly string[],
) {
  await invite(owner, admin, account, fixtures, "admin");
  const current = (
    await parsed(
      await admin.request.get(api(endpointPath(endpointId))),
      schemas.webhookEndpointResponseSchema,
      secrets,
    )
  ).endpoint;
  const updated = (
    await parsed(
      await admin.request.patch(api(endpointPath(endpointId)), {
        data: {
          displayName: current.displayName,
          url: current.url,
          eventTypes: current.eventTypes,
          productIds: current.productIds,
          retryPolicy: current.retryPolicy,
          expectedVersion: current.version,
          idempotencyKey: randomUUID(),
        },
      }),
      schemas.webhookEndpointResponseSchema,
      secrets,
    )
  ).endpoint;
  await control("/configure", {
    organizationId: scope.organizationId,
    keys,
    behavior: "success",
    workerActive: false,
  });
  await control("/seed", { ...scope, count: 1 });
  const queued = (await newest(owner, endpointId, secrets))[0]!;
  const before = stateSchema.parse(await control("/state")).captures.length;
  expect(
    (
      await owner.request.patch(api(`/users/${account.publicUserId}/role`), {
        data: { role: "viewer" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await admin.request.post(api(endpointPath(endpointId, "/enable")), {
        data: {
          expectedVersion: updated.version,
          idempotencyKey: randomUUID(),
        },
      })
    ).status(),
  ).toBe(403);
  await control("/configure", {
    organizationId: scope.organizationId,
    keys,
    behavior: "success",
    workerActive: true,
  });
  const denied = await waitDelivery(
    owner,
    endpointId,
    queued.id,
    "failed",
    secrets,
  );
  expect(denied.delivery.lastFailureCategory).toBe("authorization");
  expect(stateSchema.parse(await control("/state")).captures.length).toBe(
    before,
  );
  await control("/configure", {
    organizationId: scope.organizationId,
    keys,
    behavior: "success",
    workerActive: false,
  });
  return (
    await parsed(
      await owner.request.post(api(endpointPath(endpointId, "/enable")), {
        data: {
          expectedVersion: updated.version,
          idempotencyKey: randomUUID(),
        },
      }),
      schemas.webhookEndpointResponseSchema,
      secrets,
    )
  ).endpoint;
}

export async function checkBrowserCaches(
  page: Page,
  secrets: readonly string[],
  organizationId: string,
) {
  const observed = await page.evaluate(() => {
    type Client = {
      getQueryCache(): {
        getAll(): { queryKey: readonly unknown[]; state: { data: unknown } }[];
      };
      getMutationCache(): {
        getAll(): { state: { variables: unknown; data: unknown } }[];
      };
    };
    type Fiber = { return?: Fiber; memoizedProps?: { client?: Client } };
    for (const node of Array.from(
      document.querySelectorAll("main,button,input"),
    )) {
      const fiberName = Object.keys(node).find((key) =>
        key.startsWith("__reactFiber$"),
      );
      let fiber = fiberName
        ? (node as unknown as Record<string, Fiber>)[fiberName]
        : undefined;
      while (fiber) {
        const client = fiber.memoizedProps?.client;
        if (client && typeof client.getQueryCache === "function") {
          return {
            found: true,
            queries: client
              .getQueryCache()
              .getAll()
              .map((query) => ({
                key: query.queryKey,
                data: query.state.data,
              })),
            mutations: client
              .getMutationCache()
              .getAll()
              .map((mutation) => mutation.state),
            storage: {
              local: { ...localStorage },
              session: { ...sessionStorage },
            },
          };
        }
        fiber = fiber.return;
      }
    }
    return { found: false, queries: [], mutations: [], storage: null };
  });
  expect(observed.found, "Inspect the actual mounted React Query client").toBe(
    true,
  );
  expect(
    observed.queries.some((query) => query.key.includes(organizationId)),
  ).toBe(true);
  expect(observed.mutations).toHaveLength(0);
  for (const secret of secrets)
    expect(JSON.stringify(observed)).not.toContain(secret);
}

/** Match every recipient before deleting explicit message IDs; never clear the shared inbox. */
export async function cleanupMail(emails: readonly string[]) {
  if (!emails.length) return;
  const origin = process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
  const listing = await fetch(`${origin}/api/v1/messages?limit=1000`);
  expect(listing.ok).toBe(true);
  const payload = z
    .object({ messages: z.array(z.object({ ID: z.string() }).passthrough()) })
    .passthrough()
    .parse(await listing.json());
  const ownedIds: string[] = [];
  for (const message of payload.messages) {
    const response = await fetch(
      `${origin}/api/v1/message/${encodeURIComponent(message.ID)}`,
    );
    if (!response.ok) continue;
    const detail = z
      .object({ To: z.array(z.object({ Address: z.string() }).passthrough()) })
      .passthrough()
      .parse(await response.json());
    if (
      detail.To.length &&
      detail.To.every(({ Address }) => emails.includes(Address.toLowerCase()))
    )
      ownedIds.push(message.ID);
  }
  if (!ownedIds.length) return;
  const deletion = await fetch(`${origin}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: ownedIds }),
  });
  expect(deletion.ok).toBe(true);
}

export async function mcpCheckpoint(
  manifest: Readonly<{
    ownerEmail: string;
    organizationId: string;
    endpointId: string;
    webOrigin: string;
  }>,
  wait = false,
) {
  const directory = process.env.M1103_CHECKPOINT_DIRECTORY;
  if (!directory) return;
  if (!directory.includes("cra-m1103-checkpoint-"))
    throw new Error("Checkpoint must be a run-owned temporary directory");
  await writeFile(
    join(directory, "ready.json"),
    JSON.stringify(
      {
        ...manifest,
        status: wait ? "journey-complete-awaiting-mcp" : "read-load-running",
      },
      null,
      2,
    ),
  );
  if (!wait) {
    console.log(
      `M11-03 generated owner ready for MCP: ${manifest.ownerEmail}; org ${manifest.organizationId}; endpoint ${manifest.endpointId}; ${manifest.webOrigin}/connectors/webhooks`,
    );
    return;
  }
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    try {
      await access(join(directory, "mcp-done"));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await pause(1000);
  }
  throw new Error(
    "MCP checkpoint was not completed before scoped cleanup deadline",
  );
}
