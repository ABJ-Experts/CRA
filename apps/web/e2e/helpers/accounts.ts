import { createHash, randomUUID } from "node:crypto";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */

import type {
  APIRequestContext,
  BrowserContext,
  TestInfo,
} from "@playwright/test";

const API_PREFIX = "/api/v1";
const API_ORIGIN = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333";
const MAILPIT_ORIGIN =
  process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Password123";
const PRODUCT_IMPORT_BUCKET = "product-imports";

const configuredRunId = process.env.E2E_RUN_ID;
if (configuredRunId && !/^[a-zA-Z0-9-]{8,80}$/.test(configuredRunId)) {
  throw new Error(
    "E2E_RUN_ID must contain only 8-80 letters, digits, or dashes",
  );
}
export const E2E_RUN_ID = configuredRunId ?? randomUUID().replaceAll("-", "");

export interface TestAccount {
  readonly email: string;
  readonly password: string;
  readonly publicUserId: string;
  readonly authUserId: string;
}

interface MailpitMessage {
  readonly ID?: string;
  readonly Id?: string;
}

interface MailpitMessageDetail {
  readonly To?: readonly Readonly<{ Address?: string }>[];
  readonly Text?: string;
  readonly HTML?: string;
}

interface SessionBody {
  readonly user: { readonly id: string; readonly email: string };
}

function safeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function mailFor(
  email: string,
  pattern: RegExp,
  accepts: (value: string) => boolean = () => true,
): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const list = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages?limit=100`);
    if (list.ok) {
      const payload = (await list.json()) as { messages?: MailpitMessage[] };
      for (const candidate of payload.messages ?? []) {
        const id = candidate.ID ?? candidate.Id;
        if (!id) continue;
        const messageResponse = await fetch(
          `${MAILPIT_ORIGIN}/api/v1/message/${id}`,
        );
        if (!messageResponse.ok) continue;
        const message = (await messageResponse.json()) as MailpitMessageDetail;
        if (
          !message.To?.some(
            ({ Address }) => Address?.toLowerCase() === email.toLowerCase(),
          )
        )
          continue;
        const match = pattern.exec(
          `${message.Text ?? ""}\n${message.HTML ?? ""}`,
        );
        if (match?.[1]) {
          const value = decodeURIComponent(match[1]);
          if (accepts(value)) return value;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Mailpit message to ${email}`);
}

async function supabase(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for exact E2E cleanup",
    );
  }
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      ...init.headers,
    },
  });
}

type StorageObject = Readonly<{ name?: string; id?: string | null }>;

async function listStorageObjects(
  bucket: string,
  prefix: string,
): Promise<readonly string[]> {
  const objects: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await supabase(`/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset }),
    });
    const body = await responseBody(response);
    if (!response.ok || !Array.isArray(body)) {
      throw new Error(
        `Could not list scoped storage objects for ${bucket}/${prefix}: ${JSON.stringify(body)}`,
      );
    }
    for (const entry of body as StorageObject[]) {
      if (
        !entry.name ||
        entry.name.includes("..") ||
        entry.name.includes("\\")
      ) {
        throw new Error(`Unexpected scoped storage object name in ${bucket}`);
      }
      const path = `${prefix}${entry.name}`;
      if (entry.id === null) {
        objects.push(...(await listStorageObjects(bucket, `${path}/`)));
      } else {
        objects.push(path);
      }
    }
    if (body.length < 1000) return objects;
  }
}

async function removeImportStorageObjects(
  bucket: string,
  organizationId: string,
  importIds: readonly string[],
): Promise<void> {
  for (const importId of importIds) {
    const prefix = `${organizationId}/${importId}/`;
    const objects = await listStorageObjects(bucket, prefix);
    if (objects.some((object) => !object.startsWith(prefix))) {
      throw new Error(`Refusing to remove storage outside ${bucket}/${prefix}`);
    }
    for (let index = 0; index < objects.length; index += 1000) {
      const prefixes = objects.slice(index, index + 1000);
      const response = await supabase(`/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefixes }),
      });
      if (!response.ok) {
        throw new Error(
          `Could not remove scoped storage objects for ${bucket}/${prefix}: ${JSON.stringify(await responseBody(response))}`,
        );
      }
    }
    const remaining = await listStorageObjects(bucket, prefix);
    if (remaining.length !== 0) {
      throw new Error(
        `Scoped storage cleanup assertion failed for ${bucket}/${prefix}`,
      );
    }
  }
}

async function runScopedImportIds(
  organizationId: string,
): Promise<readonly string[]> {
  const response = await supabase(
    `/rest/v1/product_import_jobs?select=id&organization_id=eq.${encodeURIComponent(organizationId)}`,
  );
  const body = await responseBody(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new Error(
      `Could not resolve scoped import fixtures for ${organizationId}: ${JSON.stringify(body)}`,
    );
  }
  return body.flatMap((row: unknown) => {
    if (!row || typeof row !== "object" || !("id" in row)) return [];
    return typeof row.id === "string" ? [row.id] : [];
  });
}

export class RunScopedAccounts {
  private readonly accounts: TestAccount[] = [];
  private readonly invitationIds = new Set<string>();
  private readonly organizationIds = new Set<string>();
  private sequence = 0;

  constructor(private readonly testInfo: TestInfo) {}

  private identity(label: string) {
    this.sequence += 1;
    const digest = createHash("sha256")
      .update(
        `${E2E_RUN_ID}:${this.testInfo.workerIndex}:${this.testInfo.retry}:${label}:${this.sequence}`,
      )
      .digest("hex")
      .slice(0, 12);
    const stem = `e2e-${safeLabel(label)}-${digest}`;
    return { email: `${stem}@cra.test`, username: stem.slice(0, 32) };
  }

  async createVerified(
    context: BrowserContext,
    label: string,
  ): Promise<TestAccount> {
    const identity = this.identity(label);
    const signUp = await context.request.post(
      `${API_ORIGIN}${API_PREFIX}/auth/sign-up`,
      {
        data: { ...identity, password: PASSWORD },
      },
    );
    if (signUp.status() !== 201) {
      throw new Error(
        `Sign-up failed (${signUp.status()}): ${await signUp.text()}`,
      );
    }

    const code = await mailFor(identity.email, /(?:^|\D)(\d{6})(?:\D|$)/);
    const verify = await context.request.post(
      `${API_ORIGIN}${API_PREFIX}/auth/verify-email`,
      {
        data: { code },
      },
    );
    if (verify.status() !== 200) {
      throw new Error(
        `Email verification failed (${verify.status()}): ${await verify.text()}`,
      );
    }

    const session = await context.request.get(
      `${API_ORIGIN}${API_PREFIX}/auth/session`,
    );
    if (session.status() !== 200) {
      throw new Error(
        `Session lookup failed (${session.status()}): ${await session.text()}`,
      );
    }
    const body = (await session.json()) as SessionBody;
    const profile = await supabase(
      `/rest/v1/users?select=auth_user_id&id=eq.${encodeURIComponent(body.user.id)}`,
    );
    const rows = (await profile.json()) as { auth_user_id: string }[];
    if (!profile.ok || rows.length !== 1 || !rows[0]?.auth_user_id) {
      throw new Error(
        `Could not resolve exact auth user for ${identity.email}`,
      );
    }
    const account = {
      email: identity.email,
      password: PASSWORD,
      publicUserId: body.user.id,
      authUserId: rows[0].auth_user_id,
    };
    this.accounts.push(account);
    return account;
  }

  trackInvitation(id: string): void {
    this.invitationIds.add(id);
  }

  /**
   * M1 profiles retain creation and update actors, so their user must be
   * deleted only after the organization cascade has removed those references.
   */
  trackOrganization(id: string): void {
    this.organizationIds.add(id);
  }

  async invitationToken(email: string): Promise<string> {
    const response = await supabase(
      `/rest/v1/invitations?select=token_hash&email=eq.${encodeURIComponent(email)}&status=eq.pending`,
    );
    const body = await responseBody(response);
    if (!response.ok || !Array.isArray(body)) {
      throw new Error(`Could not resolve pending invitation for ${email}`);
    }
    const hashes = new Set(
      body.flatMap((row: unknown) => {
        if (!row || typeof row !== "object" || !("token_hash" in row)) {
          return [];
        }
        const tokenHash = (row as { token_hash?: unknown }).token_hash;
        return typeof tokenHash === "string" ? [tokenHash] : [];
      }),
    );
    return mailFor(email, /accept-invitation\?token=([a-f0-9]{64})/, (token) =>
      hashes.has(createHash("sha256").update(token).digest("hex")),
    );
  }

  async expireInvitation(id: string): Promise<void> {
    this.trackInvitation(id);
    const response = await supabase(
      `/rest/v1/invitations?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expires_at: "2000-01-01T00:00:00.000Z" }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Could not expire invitation: ${JSON.stringify(await responseBody(response))}`,
      );
  }

  async cleanup(): Promise<void> {
    for (const id of this.organizationIds) {
      const importIds = await runScopedImportIds(id);
      // Keep this explicit rather than relying on the organization cascade:
      // relationship/finding rows deliberately use restrictive composite FKs
      // while they are authoritative. Every request is narrowed to the unique
      // run-scoped organization, so seeded and concurrent E2E organizations
      // are never selected.
      await removeImportStorageObjects(PRODUCT_IMPORT_BUCKET, id, importIds);
      for (const importId of importIds) {
        for (const [table, scope] of [
          [
            "product_import_rows",
            `import_id=eq.${encodeURIComponent(importId)}`,
          ],
          [
            "product_import_jobs",
            `id=eq.${encodeURIComponent(importId)}&organization_id=eq.${encodeURIComponent(id)}`,
          ],
        ] as const) {
          const deletion = await supabase(`/rest/v1/${table}?${scope}`, {
            method: "DELETE",
          });
          if (!deletion.ok) {
            throw new Error(
              `Could not clean scoped ${table} fixture ${importId}: ${JSON.stringify(await responseBody(deletion))}`,
            );
          }
          const assertion = await supabase(
            `/rest/v1/${table}?select=id&${scope}`,
          );
          const rows = await responseBody(assertion);
          if (!assertion.ok || !Array.isArray(rows) || rows.length !== 0) {
            throw new Error(
              `Scoped cleanup assertion failed for ${table} / ${importId}: ${JSON.stringify(rows)}`,
            );
          }
        }
      }
      for (const table of [
        "finding_product_impact_overrides",
        "finding_impact_associations",
        "finding_propagation_jobs",
        "finding_propagation_sources",
        "product_relationships",
        "software_baseline_release_memberships",
        "product_lifecycle_dependency_facts",
        "software_baselines",
        "product_release_create_idempotencies",
        "product_create_idempotencies",
        "product_legal_entity_assignments",
        "product_releases",
        "products",
      ]) {
        const dependentResponse = await supabase(
          `/rest/v1/${table}?organization_id=eq.${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!dependentResponse.ok) {
          throw new Error(
            `Could not clean ${table} fixture rows for ${id}: ${JSON.stringify(await responseBody(dependentResponse))}`,
          );
        }
      }
      // The durable outbox is intentionally not writable through the public
      // service-role REST surface. Its release and organization foreign keys
      // cascade during the scoped product/organization cleanup above, which
      // preserves the same dependency order without broadening its grants.
      const response = await supabase(
        `/rest/v1/organizations?id=eq.${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(
          `Could not clean organization fixture ${id}: ${JSON.stringify(await responseBody(response))}`,
        );
      }
      for (const table of [
        "finding_propagation_sources",
        "finding_propagation_jobs",
        "finding_impact_associations",
        "finding_product_impact_overrides",
        "software_baselines",
        "product_relationships",
        "products",
        "organizations",
      ]) {
        const scope =
          table === "organizations"
            ? `id=eq.${encodeURIComponent(id)}`
            : `organization_id=eq.${encodeURIComponent(id)}`;
        const assertion = await supabase(
          `/rest/v1/${table}?select=id&${scope}`,
        );
        const rows = await responseBody(assertion);
        if (!assertion.ok || !Array.isArray(rows) || rows.length !== 0) {
          throw new Error(
            `Scoped cleanup assertion failed for ${table} / ${id}: ${JSON.stringify(rows)}`,
          );
        }
      }
    }
    for (const id of this.invitationIds) {
      await supabase(
        `/rest/v1/audit_logs?entity_id=eq.${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      await supabase(`/rest/v1/invitations?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    }
    for (const account of this.accounts) {
      const loginAttempts = await supabase(
        `/rest/v1/auth_login_attempts?email=eq.${encodeURIComponent(account.email)}`,
        { method: "DELETE" },
      );
      if (!loginAttempts.ok) {
        throw new Error(
          `Could not clean login-attempt fixture: ${JSON.stringify(await responseBody(loginAttempts))}`,
        );
      }
      const response = await supabase(
        `/auth/v1/admin/users/${encodeURIComponent(account.authUserId)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(
          `Exact cleanup failed for ${account.email}: ${JSON.stringify(await responseBody(response))}`,
        );
      }
    }
  }
}

export async function signIn(
  request: APIRequestContext,
  email: string,
  password = PASSWORD,
) {
  return request.post(`${API_ORIGIN}${API_PREFIX}/auth/sign-in`, {
    data: { email, password, remember: true },
  });
}

export const LIVE_API_ORIGIN = API_ORIGIN;
