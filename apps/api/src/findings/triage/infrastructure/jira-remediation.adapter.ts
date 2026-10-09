import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type JiraFetch = (url: string, init: RequestInit) => Promise<Response>;

export type JiraConnection = Readonly<{
  cloudId: string;
  token: string;
}>;

export type JiraIssueIdentity = Readonly<{
  id: string;
  key: string;
  projectId: string;
  issueTypeId: string;
  statusId: string;
  statusName: string;
  updatedAt: string | null;
  self: string;
}>;

export type JiraSiteInfo = Readonly<{
  siteHost: string;
}>;

export type JiraAdapterErrorCode =
  | "auth_failed"
  | "missing_scope"
  | "rate_limited"
  | "timeout"
  | "not_found"
  | "operator_conflict"
  | "malformed_response"
  | "provider_unavailable";

export class JiraAdapterError extends Error {
  constructor(
    readonly code: JiraAdapterErrorCode,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
    readonly definitiveCreateRejection = false,
  ) {
    super(`Jira request failed: ${code}`);
    this.name = "JiraAdapterError";
  }
}

export type JiraCreateIssueInput = Readonly<{
  projectId: string;
  issueTypeId: string;
  summary: string;
  description: string;
  correlation: Readonly<{
    propertyKey: string;
    value: Readonly<Record<string, unknown>>;
  }>;
  fields?: Readonly<Record<string, unknown>>;
}>;

export type JiraRequiredField = Readonly<{
  id: string;
  name: string;
  type: string | null;
}>;

export type JiraInvalidField = Readonly<{
  id: string;
  name: string;
  expectedType: string;
  actualType: string;
}>;

export type JiraCreateIssueDryRun = Readonly<{
  creatable: boolean;
  requiredFields: readonly JiraRequiredField[];
  invalidFields?: readonly JiraInvalidField[];
}>;

export type JiraCorrelationLookupInput = Readonly<{
  projectId: string;
  propertyKey: string;
  field: string;
  value: string;
  createdAfter: string;
  limit?: number;
}>;

export type JiraIssueCorrelationInput = Readonly<{
  propertyKey: string;
  field: string;
  value: string;
}>;

export type JiraUpdateIssueInput = Readonly<{
  issueIdOrKey: string;
  fields: Readonly<Record<string, unknown>>;
}>;

export type JiraTransitionIssueInput = Readonly<{
  issueIdOrKey: string;
  transitionId: string;
}>;

export type JiraProjectMetadata = Readonly<{
  id: string;
  key: string;
  name: string;
}>;

export type JiraTransitionMetadata = Readonly<{
  id: string;
  name: string;
  toStatusId: string;
  toStatusName: string;
}>;

const cloudIdSchema = z.uuid();
const tokenSchema = z.string().min(1).max(20_000);
const jiraIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
const jiraKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/);
const projectKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/);
const propertyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/);
const fieldsSchema = z.record(z.string().min(1).max(255), z.unknown());
const issueSchema = z.object({
  id: jiraIdSchema,
  key: jiraKeySchema,
  self: z.string().url(),
  fields: z.object({
    project: z.object({ id: jiraIdSchema }),
    issuetype: z.object({ id: jiraIdSchema }),
    status: z.object({ id: jiraIdSchema, name: z.string().min(1).max(200) }),
    updated: z.string().nullable().optional(),
  }),
});
const projectPageSchema = z.object({
  startAt: z.number().int().nonnegative(),
  maxResults: z.number().int().positive().max(50),
  total: z.number().int().nonnegative(),
  values: z.array(
    z.object({
      id: jiraIdSchema,
      key: projectKeySchema,
      name: z.string().min(1).max(200),
    }),
  ),
});
const projectSchema = z.object({
  id: jiraIdSchema,
  key: projectKeySchema,
  name: z.string().min(1).max(200),
});
const transitionsSchema = z.object({
  transitions: z.array(
    z.object({
      id: jiraIdSchema,
      name: z.string().min(1).max(200),
      to: z.object({
        id: jiraIdSchema,
        name: z.string().min(1).max(200),
      }),
    }),
  ),
});
const createIssueResponseSchema = z.object({
  id: jiraIdSchema,
  key: jiraKeySchema,
});
const createMetadataSchema = z.object({
  fields: z.array(
    z.object({
      fieldId: z.string().min(1).max(255),
      name: z.string().min(1).max(255),
      required: z.boolean().default(false),
      schema: z
        .object({ type: z.string().min(1).max(100).optional() })
        .optional(),
    }),
  ),
});
const searchSchema = z.object({
  issues: z.array(issueSchema).max(50),
  isLast: z.boolean().optional(),
  nextPageToken: z.string().optional(),
});
const propertySchema = z.object({ value: z.record(z.string(), z.unknown()) });
const serverInfoSchema = z.object({ baseUrl: z.string() });
const reservedCreateFields = new Set([
  "project",
  "issuetype",
  "summary",
  "description",
  "properties",
]);

export class JiraRemediationAdapter {
  private readonly fetch: JiraFetch;
  private readonly timeoutMs: number;

  constructor(
    options: Readonly<{
      fetch?: JiraFetch;
      timeoutMs?: number;
    }> = {},
  ) {
    this.fetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getSiteInfo(connection: JiraConnection): Promise<JiraSiteInfo> {
    this.assertConnection(connection);
    const serverInfo = parseProviderResponse(
      serverInfoSchema,
      await this.request(connection, "GET", "/rest/api/3/serverInfo"),
    );
    return Object.freeze({ siteHost: jiraCloudSiteHost(serverInfo.baseUrl) });
  }

  async listProjects(
    connection: JiraConnection,
    limit = 50,
  ): Promise<readonly JiraProjectMetadata[]> {
    this.assertConnection(connection);
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const projects: JiraProjectMetadata[] = [];
    for (let startAt = 0; projects.length < boundedLimit; startAt += 50) {
      const page = projectPageSchema.parse(
        await this.request(connection, "GET", "/rest/api/3/project/search", {
          query: { startAt: String(startAt), maxResults: "50" },
        }),
      );
      projects.push(...page.values);
      if (
        projects.length >= boundedLimit ||
        startAt + page.maxResults >= page.total
      ) {
        break;
      }
    }
    return Object.freeze(projects.slice(0, boundedLimit));
  }

  async getProject(
    connection: JiraConnection,
    projectId: string,
  ): Promise<JiraProjectMetadata> {
    this.assertConnection(connection);
    const project = parseProviderResponse(
      projectSchema,
      await this.request(
        connection,
        "GET",
        `/rest/api/3/project/${encodeURIComponent(jiraIdSchema.parse(projectId))}`,
      ),
    );
    return Object.freeze(project);
  }

  async dryRunCreateIssue(
    connection: JiraConnection,
    input: Pick<JiraCreateIssueInput, "projectId" | "issueTypeId"> &
      Readonly<{ fields?: Readonly<Record<string, unknown>> }>,
  ): Promise<JiraCreateIssueDryRun> {
    this.assertConnection(connection);
    jiraIdSchema.parse(input.projectId);
    jiraIdSchema.parse(input.issueTypeId);
    const metadata = createMetadataSchema.parse(
      await this.request(
        connection,
        "GET",
        `/rest/api/3/issue/createmeta/${encodeURIComponent(
          input.projectId,
        )}/issuetypes/${encodeURIComponent(input.issueTypeId)}`,
      ),
    );
    const supplied = new Set(Object.keys(input.fields ?? {}));
    const requiredFields = metadata.fields
      .filter(
        (field) =>
          field.required &&
          !reservedCreateFields.has(field.fieldId) &&
          !supplied.has(field.fieldId),
      )
      .map((field) =>
        Object.freeze({
          id: field.fieldId,
          name: field.name,
          type: field.schema?.type ?? null,
        }),
      );
    const invalidFields = metadata.fields
      .map((field) =>
        suppliedFieldTypeError(field, input.fields?.[field.fieldId]),
      )
      .filter((field): field is JiraInvalidField => field !== null);
    return Object.freeze({
      creatable: requiredFields.length === 0 && invalidFields.length === 0,
      requiredFields,
      ...(invalidFields.length === 0 ? {} : { invalidFields }),
    });
  }

  async createIssue(
    connection: JiraConnection,
    input: JiraCreateIssueInput,
  ): Promise<JiraIssueIdentity> {
    this.assertConnection(connection);
    let response: unknown;
    try {
      response = await this.request(connection, "POST", "/rest/api/3/issue", {
        body: {
          fields: {
            ...safeExtraFields(input.fields ?? {}),
            project: { id: jiraIdSchema.parse(input.projectId) },
            issuetype: { id: jiraIdSchema.parse(input.issueTypeId) },
            summary: z.string().trim().min(1).max(255).parse(input.summary),
            description: jiraAdfParagraph(input.description),
          },
          properties: [
            {
              key: propertyKeySchema.parse(input.correlation.propertyKey),
              value: fieldsSchema.parse(input.correlation.value),
            },
          ],
        },
      });
    } catch (error) {
      if (
        error instanceof JiraAdapterError &&
        [400, 401, 403, 404, 422].includes(error.status ?? 0)
      ) {
        throw new JiraAdapterError(
          error.code,
          error.status,
          error.retryAfterSeconds,
          true,
        );
      }
      throw error;
    }
    const created = createIssueResponseSchema.parse(response);
    return this.getIssue(connection, created.id);
  }

  async findIssueByCorrelation(
    connection: JiraConnection,
    input: JiraCorrelationLookupInput,
  ): Promise<JiraIssueIdentity | null> {
    this.assertConnection(connection);
    const propertyKey = propertyKeySchema.parse(input.propertyKey);
    const field = propertyKeySchema.parse(input.field);
    const projectId = jiraIdSchema.parse(input.projectId);
    const createdAfter = jiraJqlConservativeDate(input.createdAfter);
    const limit = String(Math.min(Math.max(input.limit ?? 20, 1), 50));
    const jql = `project = ${projectId} AND created >= "${createdAfter}" ORDER BY created DESC`;
    const result = searchSchema.parse(
      await this.request(connection, "GET", "/rest/api/3/search/jql", {
        query: {
          jql,
          maxResults: limit,
          fields: "project,issuetype,status,updated",
        },
      }),
    );
    if (
      result.isLast === false ||
      Boolean(result.nextPageToken) ||
      (result.isLast !== true && result.issues.length >= Number(limit))
    ) {
      throw new JiraAdapterError("operator_conflict");
    }
    const matched: JiraIssueIdentity[] = [];
    for (const issue of result.issues) {
      if (issue.fields.project.id !== projectId) {
        throw new JiraAdapterError("operator_conflict");
      }
      let property: Readonly<Record<string, unknown>> | null;
      try {
        property = await this.getIssueProperty(
          connection,
          issue.id,
          propertyKey,
        );
      } catch {
        throw new JiraAdapterError("operator_conflict");
      }
      if (property?.[field] === input.value) matched.push(issueIdentity(issue));
      if (matched.length > 1) throw new JiraAdapterError("operator_conflict");
    }
    return matched[0] ?? null;
  }

  async getIssue(
    connection: JiraConnection,
    issueIdOrKey: string,
  ): Promise<JiraIssueIdentity> {
    this.assertConnection(connection);
    const issue = issueSchema.parse(
      await this.request(
        connection,
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}`,
        { query: { fields: "project,issuetype,status,updated" } },
      ),
    );
    return issueIdentity(issue);
  }

  async getIssueProperty(
    connection: JiraConnection,
    issueIdOrKey: string,
    propertyKey: string,
  ): Promise<Readonly<Record<string, unknown>> | null> {
    this.assertConnection(connection);
    try {
      const property = propertySchema.parse(
        await this.request(
          connection,
          "GET",
          `/rest/api/3/issue/${encodeURIComponent(
            issueIdOrKey,
          )}/properties/${encodeURIComponent(propertyKeySchema.parse(propertyKey))}`,
        ),
      );
      return Object.freeze({ ...property.value });
    } catch (error) {
      if (error instanceof JiraAdapterError && error.code === "not_found") {
        return null;
      }
      throw error;
    }
  }

  async getIssueWithCorrelation(
    connection: JiraConnection,
    issueIdOrKey: string,
    correlation: JiraIssueCorrelationInput,
  ): Promise<JiraIssueIdentity | null> {
    const issue = await this.getIssue(connection, issueIdOrKey);
    const property = await this.getIssueProperty(
      connection,
      issueIdOrKey,
      correlation.propertyKey,
    );
    const field = propertyKeySchema.parse(correlation.field);
    return property?.[field] === correlation.value ? issue : null;
  }

  async updateIssue(
    connection: JiraConnection,
    input: JiraUpdateIssueInput,
  ): Promise<void> {
    this.assertConnection(connection);
    await this.request(
      connection,
      "PUT",
      `/rest/api/3/issue/${encodeURIComponent(input.issueIdOrKey)}`,
      { body: { fields: fieldsSchema.parse(input.fields) }, empty: true },
    );
  }

  async transitionIssue(
    connection: JiraConnection,
    input: JiraTransitionIssueInput,
  ): Promise<void> {
    this.assertConnection(connection);
    await this.request(
      connection,
      "POST",
      `/rest/api/3/issue/${encodeURIComponent(input.issueIdOrKey)}/transitions`,
      {
        body: { transition: { id: jiraIdSchema.parse(input.transitionId) } },
        empty: true,
      },
    );
  }

  async getTransitions(
    connection: JiraConnection,
    issueIdOrKey: string,
  ): Promise<readonly JiraTransitionMetadata[]> {
    this.assertConnection(connection);
    const result = parseProviderResponse(
      transitionsSchema,
      await this.request(
        connection,
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
      ),
    );
    return Object.freeze(
      result.transitions.map((transition) =>
        Object.freeze({
          id: transition.id,
          name: transition.name,
          toStatusId: transition.to.id,
          toStatusName: transition.to.name,
        }),
      ),
    );
  }

  private async request(
    connection: JiraConnection,
    method: string,
    path: string,
    options: Readonly<{
      body?: unknown;
      query?: Readonly<Record<string, string>>;
      empty?: boolean;
    }> = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = this.url(connection.cloudId, path, options.query);
    try {
      const response = await this.fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${connection.token}`,
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
      if (!response.ok) throw this.error(response);
      if (options.empty || response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new JiraAdapterError("malformed_response", response.status);
      }
    } catch (error) {
      if (error instanceof JiraAdapterError) throw error;
      if (isAbortError(error)) throw new JiraAdapterError("timeout");
      throw new JiraAdapterError("provider_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private error(response: Response): JiraAdapterError {
    const retryAfterSeconds = parseRetryAfter(
      response.headers.get("retry-after"),
    );
    if (response.status === 401) {
      return new JiraAdapterError(
        "auth_failed",
        response.status,
        retryAfterSeconds,
      );
    }
    if (response.status === 403) {
      return new JiraAdapterError(
        "missing_scope",
        response.status,
        retryAfterSeconds,
      );
    }
    if (response.status === 404) {
      return new JiraAdapterError(
        "not_found",
        response.status,
        retryAfterSeconds,
      );
    }
    if (response.status === 429) {
      return new JiraAdapterError(
        "rate_limited",
        response.status,
        retryAfterSeconds,
      );
    }
    return new JiraAdapterError(
      "provider_unavailable",
      response.status,
      retryAfterSeconds,
    );
  }

  private url(
    cloudId: string,
    path: string,
    query?: Readonly<Record<string, string>>,
  ): string {
    const url = new URL(
      `https://api.atlassian.com/ex/jira/${cloudIdSchema.parse(cloudId)}${path}`,
    );
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private assertConnection(connection: JiraConnection): void {
    cloudIdSchema.parse(connection.cloudId);
    tokenSchema.parse(connection.token);
  }
}

export function verifyJiraWebhookSignature(
  rawBody: Buffer,
  input: Readonly<{ secret: string; signature: string | null | undefined }>,
): boolean {
  if (
    !Buffer.isBuffer(rawBody) ||
    rawBody.byteLength === 0 ||
    rawBody.byteLength > 1_048_576 ||
    !input.secret ||
    !input.signature ||
    !/^sha256=[a-f0-9]{64}$/.test(input.signature)
  ) {
    return false;
  }
  const expected = createHmac("sha256", input.secret).update(rawBody).digest();
  const received = Buffer.from(input.signature.slice("sha256=".length), "hex");
  return (
    expected.byteLength === received.byteLength &&
    timingSafeEqual(expected, received)
  );
}

export function jiraWebhookDeliveryIdentity(
  input: Readonly<{ cloudId: string; deliveryId: string | null | undefined }>,
): string | null {
  if (
    !cloudIdSchema.safeParse(input.cloudId).success ||
    !input.deliveryId ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(input.deliveryId)
  ) {
    return null;
  }
  return `jira:${input.cloudId}:${input.deliveryId}`;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  if (/^\d{1,6}$/.test(value)) return Number(value);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000));
}

function parseProviderResponse<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new JiraAdapterError("malformed_response");
  return result.data;
}

function jiraCloudSiteHost(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new JiraAdapterError("malformed_response");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/.test(url.hostname)
  ) {
    throw new JiraAdapterError("malformed_response");
  }
  return url.hostname;
}

function jiraAdfParagraph(text: string) {
  return Object.freeze({
    version: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: z.string().trim().min(1).max(32_000).parse(text),
          },
        ],
      },
    ],
  });
}

function jiraJqlConservativeDate(value: string): string {
  const parsed = z.string().datetime({ offset: true }).parse(value);
  const date = new Date(parsed);
  if (!Number.isFinite(date.getTime()))
    throw new JiraAdapterError("operator_conflict");
  // ponytail: JQL uses the service account's timezone; a two-day UTC cushion is safe for global zones, and bounded search refuses truncated results.
  return new Date(date.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
}

function safeExtraFields(fields: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(fieldsSchema.parse(fields)).filter(
      ([field]) => !reservedCreateFields.has(field),
    ),
  );
}

function suppliedFieldTypeError(
  field: z.output<typeof createMetadataSchema>["fields"][number],
  value: unknown,
): JiraInvalidField | null {
  const expectedType = field.schema?.type;
  if (expectedType === undefined || value === undefined) return null;
  const actualType = jiraFieldValueType(value);
  if (jiraFieldTypeMatches(expectedType, actualType)) return null;
  return Object.freeze({
    id: field.fieldId,
    name: field.name,
    expectedType,
    actualType,
  });
}

function jiraFieldValueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function jiraFieldTypeMatches(
  expectedType: string,
  actualType: string,
): boolean {
  if (expectedType === "number") return actualType === "number";
  if (expectedType === "string" || expectedType === "date")
    return actualType === "string";
  if (expectedType === "array") return actualType === "array";
  if (expectedType === "user" || expectedType === "option")
    return actualType === "object";
  return true;
}

function issueIdentity(issue: z.output<typeof issueSchema>): JiraIssueIdentity {
  return Object.freeze({
    id: issue.id,
    key: issue.key,
    projectId: issue.fields.project.id,
    issueTypeId: issue.fields.issuetype.id,
    statusId: issue.fields.status.id,
    statusName: issue.fields.status.name,
    updatedAt: issue.fields.updated ?? null,
    self: issue.self,
  });
}

function isAbortError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown };
  return (
    candidate.name === "AbortError" ||
    (typeof candidate.message === "string" &&
      candidate.message.toLowerCase().includes("abort"))
  );
}
