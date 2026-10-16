import { createHmac } from "node:crypto";
import {
  JiraRemediationAdapter,
  jiraWebhookDeliveryIdentity,
  verifyJiraWebhookSignature,
  type JiraFetch,
} from "./jira-remediation.adapter";

const connection = {
  cloudId: "12345678-1234-4234-8234-123456789abc",
  token: "service-account-token",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function subject(fetch: JiraFetch, timeoutMs = 1_000) {
  return new JiraRemediationAdapter({ fetch, timeoutMs });
}

function fetchMock() {
  return jest.fn<ReturnType<JiraFetch>, Parameters<JiraFetch>>();
}

type SimulatedIssue = {
  id: string;
  key: string;
  projectId: string;
  issueTypeId: string;
  statusId: string;
  statusName: string;
  updated: string;
  properties: Record<string, Record<string, unknown>>;
  fields: Record<string, unknown>;
};

function createJiraSimulator() {
  const issues = new Map<string, SimulatedIssue>();
  const byKey = new Map<string, string>();
  const projects = new Map([
    ["10000", { id: "10000", key: "CRA", name: "CRA Sentinel" }],
  ]);
  let nextIssue = 7;
  let rateLimitNext = false;
  let revoked = false;

  const fetch: JiraFetch = async (url, init) => {
    await Promise.resolve();
    if (rateLimitNext) {
      rateLimitNext = false;
      return jsonResponse(
        { errorMessages: ["rate limited"] },
        { status: 429, headers: { "retry-after": "5" } },
      );
    }
    if (revoked) {
      return jsonResponse({ errorMessages: ["forbidden"] }, { status: 403 });
    }
    if (
      (init.headers as Record<string, string>).authorization !==
      "Bearer service-account-token"
    ) {
      return jsonResponse({ errorMessages: ["unauthorized"] }, { status: 401 });
    }

    const requestUrl = new URL(url);
    const path = requestUrl.pathname.replace(
      "/ex/jira/12345678-1234-4234-8234-123456789abc",
      "",
    );
    const method = init.method ?? "GET";

    if (method === "GET" && path === "/rest/api/3/project/10000") {
      return jsonResponse(projects.get("10000"));
    }
    if (method === "POST" && path === "/rest/api/3/issue") {
      const body = parseSimulatorBody(init.body) as {
        fields: {
          project: { id: string };
          issuetype: { id: string };
          summary: string;
        };
        properties: { key: string; value: Record<string, unknown> }[];
      };
      const id = String(10000 + nextIssue);
      const key = `CRA-${nextIssue}`;
      nextIssue += 1;
      const issue: SimulatedIssue = {
        id,
        key,
        projectId: body.fields.project.id,
        issueTypeId: body.fields.issuetype.id,
        statusId: "3",
        statusName: "To Do",
        updated: "2026-09-30T10:00:00.000+0000",
        properties: Object.fromEntries(
          body.properties.map((property) => [property.key, property.value]),
        ),
        fields: { summary: body.fields.summary },
      };
      issues.set(id, issue);
      byKey.set(key, id);
      return jsonResponse({ id, key });
    }
    if (method === "GET" && path === "/rest/api/3/search/jql") {
      return jsonResponse({
        issues: [...issues.values()].map(simIssueResponse),
      });
    }

    const issueMatch = path.match(
      /^\/rest\/api\/3\/issue\/([^/]+)(?:\/(properties|transitions)(?:\/([^/]+))?)?$/,
    );
    if (!issueMatch) {
      return jsonResponse({ errorMessages: ["missing"] }, { status: 404 });
    }
    const issueId = decodeURIComponent(issueMatch[1] ?? "");
    const issue = issues.get(issueId) ?? issues.get(byKey.get(issueId) ?? "");
    if (!issue) {
      return jsonResponse({ errorMessages: ["missing"] }, { status: 404 });
    }

    if (method === "GET" && !issueMatch[2])
      return jsonResponse(simIssueResponse(issue));
    if (method === "GET" && issueMatch[2] === "properties") {
      const key = decodeURIComponent(issueMatch[3] ?? "");
      const property = issue.properties[key];
      if (!property) {
        return jsonResponse({ errorMessages: ["missing"] }, { status: 404 });
      }
      return jsonResponse({ value: property });
    }
    if (method === "PUT" && !issueMatch[2]) {
      const body = parseSimulatorBody(init.body) as {
        fields: Record<string, unknown>;
      };
      issue.fields = { ...issue.fields, ...body.fields };
      issue.updated = "2026-09-30T10:05:00.000+0000";
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && issueMatch[2] === "transitions") {
      return jsonResponse({
        transitions: [
          { id: "41", name: "Done", to: { id: "6", name: "Done" } },
        ],
      });
    }
    if (method === "POST" && issueMatch[2] === "transitions") {
      issue.statusId = "6";
      issue.statusName = "Done";
      issue.updated = "2026-09-30T10:10:00.000+0000";
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ errorMessages: ["missing"] }, { status: 404 });
  };

  return {
    fetch,
    moveIssueProject(issueId: string, projectId: string) {
      const issue = issues.get(issueId);
      if (issue) issue.projectId = projectId;
    },
    rateLimitOnce() {
      rateLimitNext = true;
    },
    revoke() {
      revoked = true;
    },
  };
}

function parseSimulatorBody(body: unknown) {
  if (typeof body !== "string") throw new Error("Expected JSON request body");
  return JSON.parse(body) as unknown;
}

function simIssueResponse(issue: SimulatedIssue) {
  return {
    id: issue.id,
    key: issue.key,
    self: `https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/${issue.id}`,
    fields: {
      project: { id: issue.projectId },
      issuetype: { id: issue.issueTypeId },
      status: { id: issue.statusId, name: issue.statusName },
      updated: issue.updated,
    },
  };
}

function requestBody(fetch: ReturnType<typeof fetchMock>, call = 0) {
  const body = fetch.mock.calls[call]?.[1].body;
  if (typeof body !== "string") throw new Error("Expected JSON request body");
  return JSON.parse(body) as unknown;
}

describe("JiraRemediationAdapter", () => {
  it("marks only a definitive create POST rejection as proof no issue was created", async () => {
    const input = {
      projectId: "10000",
      issueTypeId: "10010",
      summary: "Review finding",
      description: "Review remediation",
      correlation: {
        propertyKey: "cra.remediationTicket",
        value: { correlationId: "corr-1" },
      },
    };
    const rejectedPost = fetchMock().mockResolvedValue(
      jsonResponse({ errorMessages: ["invalid field"] }, { status: 400 }),
    );
    await expect(
      subject(rejectedPost).createIssue(connection, input),
    ).rejects.toMatchObject({
      status: 400,
      definitiveCreateRejection: true,
    });

    const acceptedThenMissing = fetchMock()
      .mockResolvedValueOnce(jsonResponse({ id: "10001", key: "CRA-7" }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }));
    await expect(
      subject(acceptedThenMissing).createIssue(connection, input),
    ).rejects.toMatchObject({
      status: 404,
      definitiveCreateRejection: false,
    });
  });

  it("refuses to infer absence from a truncated correlation search", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({
        isLast: false,
        nextPageToken: "more",
        issues: [],
      }),
    );
    await expect(
      subject(fetch).findIssueByCorrelation(connection, {
        projectId: "10000",
        propertyKey: "cra.remediationTicket",
        field: "correlationId",
        value: "corr-1",
        createdAfter: "2026-09-30T09:00:00.000Z",
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "operator_conflict" });
  });
  it("runs a local simulator create, reconcile, update, transition, and failure journey", async () => {
    const simulator = createJiraSimulator();
    const adapter = subject(simulator.fetch);

    await expect(adapter.getProject(connection, "10000")).resolves.toEqual({
      id: "10000",
      key: "CRA",
      name: "CRA Sentinel",
    });
    const created = await adapter.createIssue(connection, {
      projectId: "10000",
      issueTypeId: "10010",
      summary: "Review remediation for CVE-2026-0001",
      description: "Finding CRA-FINDING-1 needs remediation review.",
      correlation: {
        propertyKey: "cra.sentinel.remediation",
        value: { findingId: "finding-1", syncRevision: 1 },
      },
    });

    await expect(
      adapter.getIssueWithCorrelation(connection, created.key, {
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
      }),
    ).resolves.toMatchObject({ id: created.id, key: created.key });
    await expect(
      adapter.findIssueByCorrelation(connection, {
        projectId: "10000",
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
        createdAfter: "2026-09-30T09:55:00.000Z",
      }),
    ).resolves.toMatchObject({ id: created.id, key: created.key });

    await adapter.updateIssue(connection, {
      issueIdOrKey: created.key,
      fields: { summary: "Updated remediation summary" },
    });
    await expect(
      adapter.getTransitions(connection, created.key),
    ).resolves.toEqual([
      { id: "41", name: "Done", toStatusId: "6", toStatusName: "Done" },
    ]);
    await adapter.transitionIssue(connection, {
      issueIdOrKey: created.key,
      transitionId: "41",
    });
    await expect(
      adapter.getIssue(connection, created.key),
    ).resolves.toMatchObject({
      statusId: "6",
      statusName: "Done",
    });

    simulator.rateLimitOnce();
    await expect(
      adapter.getIssue(connection, created.key),
    ).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 5,
    });
    simulator.moveIssueProject(created.id, "20000");
    await expect(
      adapter.findIssueByCorrelation(connection, {
        projectId: "10000",
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
        createdAfter: "2026-09-30T09:55:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "operator_conflict" });
    simulator.revoke();
    await expect(adapter.getProject(connection, "10000")).rejects.toMatchObject(
      {
        code: "missing_scope",
        status: 403,
      },
    );
  });

  it("maps simulator transport timeout without an external Jira call", async () => {
    const adapter = subject(
      async () => Promise.reject(new DOMException("aborted", "AbortError")),
      1,
    );

    await expect(adapter.getProject(connection, "10000")).rejects.toMatchObject(
      {
        code: "timeout",
      },
    );
  });

  it("reads one Jira project by stable ID for binding validation", async () => {
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({ id: "10000", key: "CRA", name: "CRA Sentinel" }),
    );

    await expect(
      subject(fetch).getProject(connection, "10000"),
    ).resolves.toEqual({
      id: "10000",
      key: "CRA",
      name: "CRA Sentinel",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.atlassian.com/ex/jira/12345678-1234-4234-8234-123456789abc/rest/api/3/project/10000",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps Jira project not found and rate limits", async () => {
    const notFound = fetchMock().mockResolvedValueOnce(
      jsonResponse({ errorMessages: ["missing"] }, { status: 404 }),
    );
    await expect(
      subject(notFound).getProject(connection, "10000"),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });

    const rateLimited = fetchMock().mockResolvedValueOnce(
      jsonResponse(
        { errorMessages: ["limited"] },
        { status: 429, headers: { "retry-after": "9" } },
      ),
    );
    await expect(
      subject(rateLimited).getProject(connection, "10000"),
    ).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 9,
    });
  });

  it("rejects malformed Jira project identity responses", async () => {
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({ id: "10000", key: "bad key", name: "CRA Sentinel" }),
    );

    await expect(
      subject(fetch).getProject(connection, "10000"),
    ).rejects.toMatchObject({ code: "malformed_response" });
  });

  it("reads available Jira transitions for fail-closed route validation", async () => {
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({
        transitions: [
          { id: "31", name: "In Review", to: { id: "3", name: "In Review" } },
          { id: "41", name: "Closed", to: { id: "6", name: "Done" } },
        ],
      }),
    );

    await expect(
      subject(fetch).getTransitions(connection, "CRA-7"),
    ).resolves.toEqual([
      {
        id: "31",
        name: "In Review",
        toStatusId: "3",
        toStatusName: "In Review",
      },
      { id: "41", name: "Closed", toStatusId: "6", toStatusName: "Done" },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.atlassian.com/ex/jira/12345678-1234-4234-8234-123456789abc/rest/api/3/issue/CRA-7/transitions",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps Jira transition not found and rate limits", async () => {
    const notFound = fetchMock().mockResolvedValueOnce(
      jsonResponse({ errorMessages: ["missing"] }, { status: 404 }),
    );
    await expect(
      subject(notFound).getTransitions(connection, "CRA-7"),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });

    const rateLimited = fetchMock().mockResolvedValueOnce(
      jsonResponse(
        { errorMessages: ["limited"] },
        { status: 429, headers: { "retry-after": "11" } },
      ),
    );
    await expect(
      subject(rateLimited).getTransitions(connection, "CRA-7"),
    ).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 11,
    });
  });

  it("reads Jira site host from serverInfo through the Atlassian gateway", async () => {
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({ baseUrl: "https://cra-test.atlassian.net" }),
    );

    await expect(subject(fetch).getSiteInfo(connection)).resolves.toEqual({
      siteHost: "cra-test.atlassian.net",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.atlassian.com/ex/jira/12345678-1234-4234-8234-123456789abc/rest/api/3/serverInfo",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    "http://cra-test.atlassian.net",
    "https://user@cra-test.atlassian.net",
    "https://cra-test.atlassian.net/path",
    "https://evil.example.com",
  ])("rejects unsafe Jira site baseUrl %s", async (baseUrl) => {
    const fetch = fetchMock().mockResolvedValueOnce(jsonResponse({ baseUrl }));

    await expect(subject(fetch).getSiteInfo(connection)).rejects.toMatchObject({
      code: "malformed_response",
    });
  });

  it("fetches issue property for webhook correlation instead of trusting payload status", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "10001",
          key: "CRA-7",
          self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
          fields: {
            project: { id: "10000" },
            issuetype: { id: "10010" },
            status: { id: "31", name: "In Review" },
            updated: "2026-09-30T10:00:00.000+0000",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ value: { findingId: "finding-1", syncRevision: 2 } }),
      );

    await expect(
      subject(fetch).getIssueWithCorrelation(connection, "CRA-7", {
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
      }),
    ).resolves.toMatchObject({
      id: "10001",
      key: "CRA-7",
      statusId: "31",
      statusName: "In Review",
    });
    expect(String(fetch.mock.calls[1]?.[0])).toContain(
      "/rest/api/3/issue/CRA-7/properties/cra.sentinel.remediation",
    );
  });

  it("returns null when fetched issue property does not match webhook correlation", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "10001",
          key: "CRA-7",
          self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
          fields: {
            project: { id: "10000" },
            issuetype: { id: "10010" },
            status: { id: "31", name: "In Review" },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ value: { findingId: "other" } }));

    await expect(
      subject(fetch).getIssueWithCorrelation(connection, "CRA-7", {
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
      }),
    ).resolves.toBeNull();
  });

  it("creates an issue with the correlation property and refetches stable IDs", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(jsonResponse({ id: "10001", key: "CRA-7" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "10001",
          key: "CRA-7",
          self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
          fields: {
            project: { id: "10000", key: "CRA" },
            issuetype: { id: "10010", name: "Task" },
            status: { id: "3", name: "To Do" },
            updated: "2026-09-30T10:00:00.000+0000",
          },
        }),
      );

    const created = await subject(fetch).createIssue(connection, {
      projectId: "10000",
      issueTypeId: "10010",
      summary: "Review remediation for CVE-2026-0001",
      description: "Finding CRA-FINDING-1 needs remediation review.",
      correlation: {
        propertyKey: "cra.sentinel.remediation",
        value: {
          organizationId: "org-1",
          findingId: "finding-1",
          syncRevision: 1,
        },
      },
      fields: { labels: ["cra-sentinel"] },
    });

    expect(created).toEqual({
      id: "10001",
      key: "CRA-7",
      projectId: "10000",
      issueTypeId: "10010",
      statusId: "3",
      statusName: "To Do",
      updatedAt: "2026-09-30T10:00:00.000+0000",
      self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.atlassian.com/ex/jira/12345678-1234-4234-8234-123456789abc/rest/api/3/issue",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(requestBody(fetch)).toEqual({
      fields: {
        project: { id: "10000" },
        issuetype: { id: "10010" },
        summary: "Review remediation for CVE-2026-0001",
        description: {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Finding CRA-FINDING-1 needs remediation review.",
                },
              ],
            },
          ],
        },
        labels: ["cra-sentinel"],
      },
      properties: [
        {
          key: "cra.sentinel.remediation",
          value: {
            organizationId: "org-1",
            findingId: "finding-1",
            syncRevision: 1,
          },
        },
      ],
    });
    const firstInit = fetch.mock.calls[0]?.[1];
    expect(firstInit?.headers).toMatchObject({
      authorization: "Bearer service-account-token",
      "content-type": "application/json",
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.atlassian.com/ex/jira/12345678-1234-4234-8234-123456789abc/rest/api/3/issue/10001?fields=project%2Cissuetype%2Cstatus%2Cupdated",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not let extra fields overwrite fixed issue identity or properties", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(jsonResponse({ id: "10001", key: "CRA-7" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "10001",
          key: "CRA-7",
          self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
          fields: {
            project: { id: "10000" },
            issuetype: { id: "10010" },
            status: { id: "3", name: "To Do" },
            updated: null,
          },
        }),
      );

    await subject(fetch).createIssue(connection, {
      projectId: "10000",
      issueTypeId: "10010",
      summary: "Safe summary",
      description: "Safe description",
      correlation: {
        propertyKey: "cra.sentinel.remediation",
        value: { findingId: "finding-1" },
      },
      fields: {
        project: { id: "other" },
        issuetype: { id: "other" },
        summary: "Overwritten",
        description: "Overwritten",
        properties: [{ key: "evil", value: true }],
        customfield_12345: "allowed",
      },
    });

    expect(requestBody(fetch)).toEqual({
      fields: {
        project: { id: "10000" },
        issuetype: { id: "10010" },
        summary: "Safe summary",
        description: {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Safe description" }],
            },
          ],
        },
        customfield_12345: "allowed",
      },
      properties: [
        {
          key: "cra.sentinel.remediation",
          value: { findingId: "finding-1" },
        },
      ],
    });
  });

  it("dry-runs create metadata and reports missing required custom fields", async () => {
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({
        fields: [
          {
            fieldId: "summary",
            name: "Summary",
            required: true,
            schema: { type: "string" },
          },
          {
            fieldId: "description",
            name: "Description",
            required: false,
            schema: { type: "doc" },
          },
          {
            fieldId: "customfield_10031",
            name: "Security owner",
            required: true,
            schema: { type: "user" },
          },
        ],
      }),
    );

    await expect(
      subject(fetch).dryRunCreateIssue(connection, {
        projectId: "10000",
        issueTypeId: "10010",
        fields: { summary: "Ready" },
      }),
    ).resolves.toEqual({
      creatable: false,
      requiredFields: [
        { id: "customfield_10031", name: "Security owner", type: "user" },
      ],
    });
  });

  it("reports incompatible supplied custom field types during dry run", async () => {
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({
        fields: [
          {
            fieldId: "customfield_10040",
            name: "Risk score",
            required: true,
            schema: { type: "number" },
          },
          {
            fieldId: "customfield_10041",
            name: "Reviewer",
            required: false,
            schema: { type: "user" },
          },
        ],
      }),
    );

    await expect(
      subject(fetch).dryRunCreateIssue(connection, {
        projectId: "10000",
        issueTypeId: "10010",
        fields: {
          customfield_10040: "high",
          customfield_10041: { accountId: "abc" },
        },
      }),
    ).resolves.toEqual({
      creatable: false,
      requiredFields: [],
      invalidFields: [
        {
          id: "customfield_10040",
          name: "Risk score",
          expectedType: "number",
          actualType: "string",
        },
      ],
    });
  });

  it("finds a created issue by correlation before a blind create retry", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          issues: [
            {
              id: "10000",
              key: "CRA-6",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10000",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
            {
              id: "10001",
              key: "CRA-7",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
                updated: "2026-09-30T10:00:00.000+0000",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ value: { findingId: "other" } }))
      .mockResolvedValueOnce(
        jsonResponse({ value: { findingId: "finding-1" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ value: { findingId: "other" } }));

    await expect(
      subject(fetch).findIssueByCorrelation(connection, {
        projectId: "10000",
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
        createdAfter: "2026-09-30T09:55:00.000Z",
      }),
    ).resolves.toMatchObject({ id: "10001", key: "CRA-7" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/rest/api/3/search/jql"),
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(
      new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("jql"),
    ).toBe('project = 10000 AND created >= "2026-09-28" ORDER BY created DESC');
    expect(String(fetch.mock.calls[1]?.[0])).toContain(
      "/rest/api/3/issue/10000/properties/cra.sentinel.remediation",
    );
    expect(String(fetch.mock.calls[2]?.[0])).toContain(
      "/rest/api/3/issue/10001/properties/cra.sentinel.remediation",
    );
  });

  it("scans three recent issues for one correlation match without treating project activity as malformed", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          issues: [
            {
              id: "10000",
              key: "CRA-6",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10000",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
            {
              id: "10001",
              key: "CRA-7",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
            {
              id: "10002",
              key: "CRA-8",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10002",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ value: { findingId: "other-1" } }))
      .mockResolvedValueOnce(
        jsonResponse({ value: { findingId: "finding-1" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ value: { findingId: "other-2" } }));

    await expect(
      subject(fetch).findIssueByCorrelation(connection, {
        projectId: "10000",
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
        createdAfter: "2026-09-30T09:55:00.000Z",
        limit: 50,
      }),
    ).resolves.toMatchObject({ id: "10001", key: "CRA-7" });
    expect(
      new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("maxResults"),
    ).toBe("50");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("returns null for no correlation match and rejects ambiguous matches", async () => {
    const noMatch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          issues: [
            {
              id: "10001",
              key: "CRA-7",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ value: { findingId: "other" } }));
    await expect(
      subject(noMatch).findIssueByCorrelation(connection, {
        projectId: "10000",
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
        createdAfter: "2026-09-30T09:55:00.000Z",
      }),
    ).resolves.toBeNull();

    const ambiguous = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          issues: [
            {
              id: "10001",
              key: "CRA-7",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
            {
              id: "10002",
              key: "CRA-8",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10002",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
            {
              id: "10003",
              key: "CRA-9",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10003",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ value: { findingId: "finding-1" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ value: { findingId: "finding-1" } }),
      );

    await expect(
      subject(ambiguous).findIssueByCorrelation(connection, {
        projectId: "10000",
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
        createdAfter: "2026-09-30T09:55:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "operator_conflict" });
  });

  it("treats unavailable property fetch as operator conflict", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          issues: [
            {
              id: "10001",
              key: "CRA-7",
              self: "https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001",
              fields: {
                project: { id: "10000" },
                issuetype: { id: "10010" },
                status: { id: "3", name: "To Do" },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ errorMessages: ["Unavailable"] }, { status: 503 }),
      );

    await expect(
      subject(fetch).findIssueByCorrelation(connection, {
        projectId: "10000",
        propertyKey: "cra.sentinel.remediation",
        field: "findingId",
        value: "finding-1",
        createdAfter: "2026-09-30T09:55:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "operator_conflict" });
  });

  it("bounds metadata pagination and reports revoked scopes", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            startAt: 0,
            maxResults: 50,
            total: 75,
            values: [{ id: "10000", key: "CRA", name: "CRA" }],
          },
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { errorMessages: ["Forbidden"] },
          { status: 403, headers: { "retry-after": "3" } },
        ),
      );

    await expect(
      subject(fetch).listProjects(connection, 75),
    ).rejects.toMatchObject({
      code: "missing_scope",
      status: 403,
      retryAfterSeconds: 3,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("maxResults=50"),
      expect.anything(),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("startAt=50"),
      expect.anything(),
    );
  });

  it("maps timeouts and rate limits without leaking provider bodies", async () => {
    const timeoutFetch = fetchMock().mockRejectedValue(
      new DOMException("aborted", "AbortError"),
    );
    await expect(
      subject(timeoutFetch).getIssue(connection, "10001"),
    ).rejects.toMatchObject({
      code: "timeout",
      message: "Jira request failed: timeout",
    });

    const rateLimitedFetch = fetchMock().mockResolvedValue(
      jsonResponse(
        { errorMessages: ["tenant secret text"] },
        { status: 429, headers: { "retry-after": "12" } },
      ),
    );
    await expect(
      subject(rateLimitedFetch).transitionIssue(connection, {
        issueIdOrKey: "CRA-7",
        transitionId: "31",
      }),
    ).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 12,
      message: "Jira request failed: rate_limited",
    });
  });

  it("updates minimal fields and performs transitions", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await subject(fetch).updateIssue(connection, {
      issueIdOrKey: "CRA-7",
      fields: { summary: "Updated remediation summary" },
    });
    await subject(fetch).transitionIssue(connection, {
      issueIdOrKey: "CRA-7",
      transitionId: "41",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/issue/CRA-7"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          fields: { summary: "Updated remediation summary" },
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/issue/CRA-7/transitions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ transition: { id: "41" } }),
      }),
    );
  });
});

describe("Jira webhook verification", () => {
  it("verifies X-Hub-Signature with raw body bytes and exposes a duplicate hint", () => {
    const rawBody = Buffer.from(JSON.stringify({ issue: { id: "10001" } }));
    const secret = "shared-webhook-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

    expect(
      verifyJiraWebhookSignature(rawBody, {
        secret,
        signature,
      }),
    ).toBe(true);
    expect(
      jiraWebhookDeliveryIdentity({
        cloudId: connection.cloudId,
        deliveryId: "delivery-1",
      }),
    ).toBe("jira:12345678-1234-4234-8234-123456789abc:delivery-1");
  });

  it("rejects bad signatures and unsafe delivery IDs", () => {
    const rawBody = Buffer.from("{}");

    expect(
      verifyJiraWebhookSignature(rawBody, {
        secret: "shared-webhook-secret",
        signature: "sha256=bad",
      }),
    ).toBe(false);
    expect(
      jiraWebhookDeliveryIdentity({
        cloudId: connection.cloudId,
        deliveryId: "../bad",
      }),
    ).toBeNull();
  });
});
