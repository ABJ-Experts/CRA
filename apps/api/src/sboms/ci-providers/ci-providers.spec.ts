import { createHmac, generateKeyPairSync } from "node:crypto";

import {
  providerDeliveryIdentity,
  verifyCiRepository,
  verifyCiRun,
  verifyGithubWebhook,
  verifyGitlabWebhook,
  type CiProviderHttp,
} from "./index";

const response = (body: unknown, status = 200) => ({
  status,
  headers: {},
  body,
});

describe("CI provider verification", () => {
  it("confirms a GitHub repository using a token restricted to one installation repository", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(response({ token: "installation-token" }))
      .mockResolvedValueOnce(
        response({ repositories: [{ id: 42, full_name: "renamed/repo" }] }),
      );
    const result = await verifyCiRepository(
      {
        provider: "github_actions",
        providerHost: "github.com",
        repositoryId: "42",
        providerInstallationId: "9",
        credentials: {
          kind: "github_app",
          appId: "1",
          privateKeyPem: TEST_PRIVATE_KEY,
        },
      },
      { request },
    );
    expect(result).toMatchObject({
      outcome: "verified",
      repositoryId: "42",
      repositoryOwner: "renamed",
      repositoryName: "repo",
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: "https://api.github.com/installation/repositories?per_page=100",
      }),
    );
  });

  it("rejects a GitHub installation token that cannot see exactly the bound repository", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(response({ token: "installation-token" }))
      .mockResolvedValueOnce(
        response({ repositories: [{ id: 99, full_name: "other/repo" }] }),
      );
    expect(
      await verifyCiRepository(
        {
          provider: "github_actions",
          providerHost: "github.com",
          repositoryId: "42",
          providerInstallationId: "9",
          credentials: {
            kind: "github_app",
            appId: "1",
            privateKeyPem: TEST_PRIVATE_KEY,
          },
        },
        { request },
      ),
    ).toMatchObject({ outcome: "untrusted" });
  });

  it("confirms a GitLab project by stable ID and rejects merge-request pipelines", async () => {
    const input = {
      provider: "gitlab_ci" as const,
      providerHost: "gitlab.com",
      repositoryId: "44",
      credentials: { kind: "gitlab_project_token" as const, token: "secret" },
    };
    expect(
      await verifyCiRepository(input, {
        request: jest
          .fn()
          .mockResolvedValue(
            response({ id: 44, path_with_namespace: "team/repo" }),
          ),
      }),
    ).toMatchObject({ outcome: "verified", repositoryOwner: "team" });
    expect(
      await verifyCiRun(
        { ...input, runId: "71" },
        {
          request: jest.fn().mockResolvedValue(
            response({
              id: 71,
              project_id: 44,
              sha: "b".repeat(40),
              ref: "main",
              tag: false,
              source: "merge_request_event",
              created_at: "2026-09-30T10:00:00Z",
            }),
          ),
        },
      ),
    ).toMatchObject({ outcome: "untrusted" });
  });

  it("confirms an Azure definition only after service connection permissions", async () => {
    const serviceConnectionId = "123e4567-e89b-12d3-a456-426614174001";
    const projectKey = "123e4567-e89b-12d3-a456-426614174000";
    const request = jest
      .fn()
      .mockResolvedValueOnce(
        response({ id: serviceConnectionId, isReady: true }),
      )
      .mockResolvedValueOnce(
        response({
          resource: { id: serviceConnectionId, type: "endpoint" },
          allPipelines: { authorized: false },
          pipelines: [{ id: 8, authorized: true }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: 8,
          project: { id: projectKey },
          repository: { id: "repo-1" },
        }),
      );
    expect(
      await verifyCiRepository(
        {
          provider: "azure_devops",
          providerHost: "dev.azure.com",
          repositoryId: "repo-1",
          projectKey,
          pipelineDefinitionId: "8",
          azureOrganization: "example-org",
          serviceConnectionId,
          credentials: { kind: "azure_access_token", token: "secret" },
        },
        { request },
      ),
    ).toMatchObject({ outcome: "verified", repositoryId: "repo-1" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("fails closed on a malformed provider response or network outage", async () => {
    const input = {
      provider: "gitlab_ci" as const,
      providerHost: "gitlab.com",
      repositoryId: "44",
      runId: "71",
      credentials: { kind: "gitlab_project_token" as const, token: "secret" },
    };
    expect(
      await verifyCiRun(input, {
        request: jest.fn().mockResolvedValue(response({ id: 71 })),
      }),
    ).toMatchObject({ outcome: "unavailable" });
    expect(
      await verifyCiRun(input, {
        request: jest.fn().mockRejectedValue(new Error("offline")),
      }),
    ).toMatchObject({ outcome: "unavailable" });
  });

  it("fails closed when the GitHub App key or scoped token response is invalid", async () => {
    const input = {
      provider: "github_actions" as const,
      providerHost: "github.com",
      repositoryId: "42",
      providerInstallationId: "9",
      credentials: {
        kind: "github_app" as const,
        appId: "1",
        privateKeyPem: "invalid",
      },
    };
    const request = jest.fn();
    expect(await verifyCiRepository(input, { request })).toMatchObject({
      outcome: "unavailable",
    });
    expect(request).not.toHaveBeenCalled();
    expect(
      await verifyCiRepository(
        {
          ...input,
          credentials: {
            ...input.credentials,
            privateKeyPem: TEST_PRIVATE_KEY,
          },
        },
        { request: jest.fn().mockResolvedValue(response({ token: "" })) },
      ),
    ).toMatchObject({ outcome: "unavailable" });
  });

  it("rejects a changed Azure service connection before querying the build", async () => {
    const serviceConnectionId = "123e4567-e89b-12d3-a456-426614174001";
    const request = jest.fn().mockResolvedValueOnce(
      response({
        id: "123e4567-e89b-12d3-a456-426614174099",
        isReady: true,
      }),
    );
    expect(
      await verifyCiRun(
        {
          provider: "azure_devops",
          providerHost: "dev.azure.com",
          repositoryId: "repo-1",
          projectKey: "123e4567-e89b-12d3-a456-426614174000",
          pipelineDefinitionId: "8",
          azureOrganization: "example-org",
          serviceConnectionId,
          runId: "101",
          credentials: { kind: "azure_access_token", token: "secret" },
        },
        { request },
      ),
    ).toMatchObject({ outcome: "untrusted" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed GitHub repository lists and provider 5xx responses", async () => {
    const github = {
      provider: "github_actions" as const,
      providerHost: "github.com",
      repositoryId: "42",
      providerInstallationId: "9",
      credentials: {
        kind: "github_app" as const,
        appId: "1",
        privateKeyPem: TEST_PRIVATE_KEY,
      },
    };
    expect(
      await verifyCiRepository(github, {
        request: jest
          .fn()
          .mockResolvedValueOnce(response({ token: "installation-token" }))
          .mockResolvedValueOnce(response({ repositories: [] })),
      }),
    ).toMatchObject({ outcome: "untrusted" });
    expect(
      await verifyCiRepository(
        {
          provider: "gitlab_ci",
          providerHost: "gitlab.com",
          repositoryId: "44",
          credentials: { kind: "gitlab_project_token", token: "secret" },
        },
        { request: jest.fn().mockResolvedValue(response({}, 503)) },
      ),
    ).toMatchObject({ outcome: "unavailable" });
  });

  it("rejects a GitLab run attempt mismatch even for a valid push", async () => {
    expect(
      await verifyCiRun(
        {
          provider: "gitlab_ci",
          providerHost: "gitlab.com",
          repositoryId: "44",
          runId: "71",
          runAttempt: "2",
          credentials: { kind: "gitlab_project_token", token: "secret" },
        },
        {
          request: jest.fn().mockResolvedValue(
            response({
              id: 71,
              project_id: 44,
              sha: "b".repeat(40),
              ref: "main",
              tag: false,
              source: "push",
              created_at: "2026-09-30T10:00:00Z",
            }),
          ),
        },
      ),
    ).toMatchObject({ outcome: "untrusted" });
  });

  it("requires authoritative setup identity before a binding is accepted", async () => {
    const http: CiProviderHttp = {
      request: jest
        .fn()
        .mockResolvedValueOnce(
          response({ id: 99, path_with_namespace: "team/other" }),
        ),
    };
    expect(
      await verifyCiRepository(
        {
          provider: "gitlab_ci",
          providerHost: "gitlab.com",
          repositoryId: "44",
          credentials: { kind: "gitlab_project_token", token: "secret" },
        },
        http,
      ),
    ).toMatchObject({ outcome: "untrusted" });
  });

  it("rejects an Azure service connection opened to all pipelines", async () => {
    const serviceConnectionId = "123e4567-e89b-12d3-a456-426614174001";
    const http: CiProviderHttp = {
      request: jest
        .fn()
        .mockResolvedValueOnce(
          response({ id: serviceConnectionId, isReady: true }),
        )
        .mockResolvedValueOnce(
          response({
            resource: { id: serviceConnectionId, type: "endpoint" },
            allPipelines: { authorized: true },
            pipelines: [{ id: 8, authorized: true }],
          }),
        ),
    };
    expect(
      await verifyCiRepository(
        {
          provider: "azure_devops",
          providerHost: "dev.azure.com",
          repositoryId: "repo-1",
          projectKey: "123e4567-e89b-12d3-a456-426614174000",
          pipelineDefinitionId: "8",
          azureOrganization: "example-org",
          serviceConnectionId,
          credentials: { kind: "azure_access_token", token: "secret" },
        },
        http,
      ),
    ).toMatchObject({ outcome: "untrusted" });
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "another authorized pipeline",
      resourceType: "endpoint",
      pipelines: [
        { id: 8, authorized: true },
        { id: 9, authorized: true },
      ],
    },
    {
      name: "a different resource type",
      resourceType: "environment",
      pipelines: [{ id: 8, authorized: true }],
    },
  ])(
    "rejects Azure connection permissions with $name",
    async ({ resourceType, pipelines }) => {
      const serviceConnectionId = "123e4567-e89b-12d3-a456-426614174001";
      const http: CiProviderHttp = {
        request: jest
          .fn()
          .mockResolvedValueOnce(
            response({ id: serviceConnectionId, isReady: true }),
          )
          .mockResolvedValueOnce(
            response({
              resource: { id: serviceConnectionId, type: resourceType },
              allPipelines: { authorized: false },
              pipelines,
            }),
          ),
      };
      expect(
        await verifyCiRepository(
          {
            provider: "azure_devops",
            providerHost: "dev.azure.com",
            repositoryId: "repo-1",
            projectKey: "123e4567-e89b-12d3-a456-426614174000",
            pipelineDefinitionId: "8",
            azureOrganization: "example-org",
            serviceConnectionId,
            credentials: { kind: "azure_access_token", token: "secret" },
          },
          http,
        ),
      ).toMatchObject({ outcome: "untrusted" });
      expect(http.request).toHaveBeenCalledTimes(2);
    },
  );

  it("verifies GitHub App repository and run identity without trusting caller metadata", async () => {
    const http: CiProviderHttp = {
      request: jest
        .fn()
        .mockResolvedValueOnce(response({ token: "installation-token" }))
        .mockResolvedValueOnce(
          response({ repositories: [{ id: 42, full_name: "new-name/repo" }] }),
        )
        .mockResolvedValueOnce(
          response({
            id: 81,
            run_attempt: 2,
            head_sha: "a".repeat(40),
            head_branch: "main",
            event: "push",
            repository: { id: 42 },
            created_at: "2026-09-30T10:00:00Z",
          }),
        ),
    };
    const result = await verifyCiRun(
      {
        provider: "github_actions",
        providerHost: "github.com",
        repositoryId: "42",
        providerInstallationId: "9",
        runId: "81",
        runAttempt: "2",
        credentials: {
          kind: "github_app",
          appId: "1",
          privateKeyPem: TEST_PRIVATE_KEY,
        },
      },
      http,
    );
    expect(result).toMatchObject({
      outcome: "verified",
      run: {
        repositoryId: "42",
        runId: "81",
        runAttempt: "2",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
      },
    });
    const calls = jest.mocked(http.request).mock.calls;
    expect(calls[0]?.[0]?.body).toContain('"repository_ids":[42]');
    expect(calls[2]?.[0]?.url).toContain("new-name/repo/actions/runs/81");
  });

  it("rejects GitHub fork or PR event and repository substitution", async () => {
    const http: CiProviderHttp = {
      request: jest
        .fn()
        .mockResolvedValueOnce(response({ token: "installation-token" }))
        .mockResolvedValueOnce(
          response({ repositories: [{ id: 42, full_name: "a/repo" }] }),
        )
        .mockResolvedValueOnce(
          response({
            id: 81,
            run_attempt: 1,
            head_sha: "a".repeat(40),
            head_branch: "main",
            event: "pull_request_target",
            repository: { id: 42 },
            head_repository: { id: 99 },
            created_at: "2026-09-30T10:00:00Z",
          }),
        ),
    };
    await expect(
      verifyCiRun(
        {
          provider: "github_actions",
          providerHost: "github.com",
          repositoryId: "42",
          providerInstallationId: "9",
          runId: "81",
          credentials: {
            kind: "github_app",
            appId: "1",
            privateKeyPem: TEST_PRIVATE_KEY,
          },
        },
        http,
      ),
    ).resolves.toMatchObject({ outcome: "untrusted" });
  });

  it("fails closed for GitHub release runs with ambiguous tag ref identity", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(response({ token: "installation-token" }))
      .mockResolvedValueOnce(
        response({ repositories: [{ id: 42, full_name: "a/repo" }] }),
      )
      .mockResolvedValueOnce(
        response({
          id: 81,
          run_attempt: 1,
          head_sha: "a".repeat(40),
          head_branch: "v1.0.0",
          event: "release",
          repository: { id: 42 },
          created_at: "2026-09-30T10:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        response({
          ref: "refs/tags/v1.0.0",
          object: { type: "commit", sha: "b".repeat(40) },
        }),
      );
    expect(
      await verifyCiRun(
        {
          provider: "github_actions",
          providerHost: "github.com",
          repositoryId: "42",
          providerInstallationId: "9",
          runId: "81",
          credentials: {
            kind: "github_app",
            appId: "1",
            privateKeyPem: TEST_PRIVATE_KEY,
          },
        },
        { request },
      ),
    ).toMatchObject({ outcome: "untrusted" });
  });

  it("proves a lightweight GitHub release tag points to the run commit", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(response({ token: "installation-token" }))
      .mockResolvedValueOnce(
        response({ repositories: [{ id: 42, full_name: "a/repo" }] }),
      )
      .mockResolvedValueOnce(
        response({
          id: 81,
          run_attempt: 1,
          head_sha: "a".repeat(40),
          head_branch: "v1.0.0",
          event: "release",
          repository: { id: 42 },
          created_at: "2026-09-30T10:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        response({
          ref: "refs/tags/v1.0.0",
          object: { type: "commit", sha: "a".repeat(40) },
        }),
      );
    expect(
      await verifyCiRun(
        {
          provider: "github_actions",
          providerHost: "github.com",
          repositoryId: "42",
          providerInstallationId: "9",
          runId: "81",
          credentials: {
            kind: "github_app",
            appId: "1",
            privateKeyPem: TEST_PRIVATE_KEY,
          },
        },
        { request },
      ),
    ).toMatchObject({
      outcome: "verified",
      run: { ref: "refs/tags/v1.0.0", eventName: "release" },
    });
    expect(request).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        url: "https://api.github.com/repos/a/repo/git/ref/tags/v1.0.0",
      }),
    );
  });

  it("dereferences an annotated GitHub release tag to the run commit", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(response({ token: "installation-token" }))
      .mockResolvedValueOnce(
        response({ repositories: [{ id: 42, full_name: "a/repo" }] }),
      )
      .mockResolvedValueOnce(
        response({
          id: 81,
          run_attempt: 1,
          head_sha: "a".repeat(40),
          head_branch: "v1.0.0",
          event: "release",
          repository: { id: 42 },
          created_at: "2026-09-30T10:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        response({
          ref: "refs/tags/v1.0.0",
          object: { type: "tag", sha: "b".repeat(40) },
        }),
      )
      .mockResolvedValueOnce(
        response({
          object: { type: "commit", sha: "a".repeat(40) },
        }),
      );
    expect(
      await verifyCiRun(
        {
          provider: "github_actions",
          providerHost: "github.com",
          repositoryId: "42",
          providerInstallationId: "9",
          runId: "81",
          credentials: {
            kind: "github_app",
            appId: "1",
            privateKeyPem: TEST_PRIVATE_KEY,
          },
        },
        { request },
      ),
    ).toMatchObject({
      outcome: "verified",
      run: { ref: "refs/tags/v1.0.0" },
    });
    expect(request).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        url: `https://api.github.com/repos/a/repo/git/tags/${"b".repeat(40)}`,
      }),
    );
  });

  it("rejects a release when the fetched tag name differs from the run tag", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(response({ token: "installation-token" }))
      .mockResolvedValueOnce(
        response({ repositories: [{ id: 42, full_name: "a/repo" }] }),
      )
      .mockResolvedValueOnce(
        response({
          id: 81,
          run_attempt: 1,
          head_sha: "a".repeat(40),
          head_branch: "v1.0.0",
          event: "release",
          repository: { id: 42 },
          created_at: "2026-09-30T10:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        response({
          ref: "refs/tags/other",
          object: { type: "commit", sha: "a".repeat(40) },
        }),
      );
    expect(
      await verifyCiRun(
        {
          provider: "github_actions",
          providerHost: "github.com",
          repositoryId: "42",
          providerInstallationId: "9",
          runId: "81",
          credentials: {
            kind: "github_app",
            appId: "1",
            privateKeyPem: TEST_PRIVATE_KEY,
          },
        },
        { request },
      ),
    ).toMatchObject({ outcome: "untrusted" });
  });

  it("rejects a release when its tag was removed before verification", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(response({ token: "installation-token" }))
      .mockResolvedValueOnce(
        response({ repositories: [{ id: 42, full_name: "a/repo" }] }),
      )
      .mockResolvedValueOnce(
        response({
          id: 81,
          run_attempt: 1,
          head_sha: "a".repeat(40),
          head_branch: "v1.0.0",
          event: "release",
          repository: { id: 42 },
          created_at: "2026-09-30T10:00:00Z",
        }),
      )
      .mockResolvedValueOnce(response({}, 404));
    expect(
      await verifyCiRun(
        {
          provider: "github_actions",
          providerHost: "github.com",
          repositoryId: "42",
          providerInstallationId: "9",
          runId: "81",
          credentials: {
            kind: "github_app",
            appId: "1",
            privateKeyPem: TEST_PRIVATE_KEY,
          },
        },
        { request },
      ),
    ).toMatchObject({ outcome: "untrusted" });
  });

  it("verifies approved GitLab host, project, and push pipeline", async () => {
    const http: CiProviderHttp = {
      request: jest.fn().mockResolvedValueOnce(
        response({
          id: 71,
          project_id: 44,
          sha: "b".repeat(40),
          ref: "main",
          tag: false,
          source: "push",
          created_at: "2026-09-30T10:00:00Z",
        }),
      ),
    };
    const result = await verifyCiRun(
      {
        provider: "gitlab_ci",
        providerHost: "gitlab.example.com",
        repositoryId: "44",
        runId: "71",
        credentials: { kind: "gitlab_project_token", token: "secret" },
        approvedHosts: ["gitlab.example.com"],
      },
      http,
    );
    expect(result).toMatchObject({ outcome: "verified" });
    expect(result).toMatchObject({ run: { ref: "refs/heads/main" } });
    expect(jest.mocked(http.request).mock.calls[0]?.[0]?.url).toContain(
      "/api/v4/projects/44/pipelines/71",
    );
    expect(
      await verifyCiRun(
        {
          provider: "gitlab_ci",
          providerHost: "evil.example.com",
          repositoryId: "44",
          runId: "71",
          credentials: { kind: "gitlab_project_token", token: "secret" },
          approvedHosts: ["gitlab.example.com"],
        },
        http,
      ),
    ).toMatchObject({ outcome: "invalid_configuration" });
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("verifies Azure project and pipeline definition, rejecting pull requests", async () => {
    const serviceConnectionId = "123e4567-e89b-12d3-a456-426614174001";
    const http: CiProviderHttp = {
      request: jest
        .fn()
        .mockResolvedValueOnce(
          response({ id: serviceConnectionId, isReady: true }),
        )
        .mockResolvedValueOnce(
          response({
            resource: { id: serviceConnectionId, type: "endpoint" },
            allPipelines: { authorized: false },
            pipelines: [{ id: 8, authorized: true }],
          }),
        )
        .mockResolvedValueOnce(
          response({
            id: 101,
            definition: { id: 8 },
            project: { id: "123e4567-e89b-12d3-a456-426614174000" },
            repository: { id: "repo-1" },
            sourceVersion: "c".repeat(40),
            sourceBranch: "refs/heads/main",
            reason: "individualCI",
            queueTime: "2026-09-30T10:00:00Z",
          }),
        ),
    };
    const input = {
      provider: "azure_devops" as const,
      providerHost: "dev.azure.com",
      azureOrganization: "example-org",
      serviceConnectionId,
      repositoryId: "repo-1",
      projectKey: "123e4567-e89b-12d3-a456-426614174000",
      pipelineDefinitionId: "8",
      runId: "101",
      credentials: { kind: "azure_access_token" as const, token: "secret" },
    };
    expect(await verifyCiRun(input, http)).toMatchObject({
      outcome: "verified",
    });
    (http.request as jest.Mock)
      .mockResolvedValueOnce(
        response({ id: serviceConnectionId, isReady: true }),
      )
      .mockResolvedValueOnce(
        response({
          resource: { id: serviceConnectionId, type: "endpoint" },
          allPipelines: { authorized: false },
          pipelines: [{ id: 8, authorized: true }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: 101,
          definition: { id: 8 },
          project: { id: input.projectKey },
          repository: { id: "repo-1" },
          sourceVersion: "c".repeat(40),
          sourceBranch: "refs/pull/1/merge",
          reason: "pullRequest",
          queueTime: "2026-09-30T10:00:00Z",
        }),
      );
    expect(await verifyCiRun(input, http)).toMatchObject({
      outcome: "untrusted",
    });
  });

  it("uses GitLab's provider tag bit for release refs", async () => {
    const result = await verifyCiRun(
      {
        provider: "gitlab_ci",
        providerHost: "gitlab.com",
        repositoryId: "44",
        runId: "71",
        credentials: { kind: "gitlab_project_token", token: "secret" },
      },
      {
        request: jest.fn().mockResolvedValue(
          response({
            id: 71,
            project_id: 44,
            sha: "b".repeat(40),
            ref: "v1.0.0",
            tag: true,
            source: "push",
            created_at: "2026-09-30T10:00:00Z",
          }),
        ),
      },
    );
    expect(result).toMatchObject({
      outcome: "verified",
      run: { ref: "refs/tags/v1.0.0" },
    });
  });

  it("distinguishes revoked and rate-limited provider access", async () => {
    const input = {
      provider: "gitlab_ci" as const,
      providerHost: "gitlab.com",
      repositoryId: "44",
      runId: "71",
      credentials: { kind: "gitlab_project_token" as const, token: "secret" },
    };
    expect(
      await verifyCiRun(input, {
        request: jest.fn().mockResolvedValue(response({}, 401)),
      }),
    ).toMatchObject({ outcome: "revoked" });
    expect(
      await verifyCiRun(input, {
        request: jest.fn().mockResolvedValue({
          status: 429,
          headers: { "retry-after": "12" },
          body: {},
        }),
      }),
    ).toMatchObject({ outcome: "rate_limited", retryAfterSeconds: 12 });
    expect(
      await verifyCiRun(input, {
        request: jest.fn().mockResolvedValue({
          status: 403,
          headers: { "retry-after": "21", "x-ratelimit-remaining": "0" },
          body: {},
        }),
      }),
    ).toMatchObject({ outcome: "rate_limited", retryAfterSeconds: 21 });
  });
});

describe("CI webhook verification", () => {
  it("verifies GitHub raw body and requires delivery identity", () => {
    const body = Buffer.from('{"action":"completed"}');
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    expect(
      verifyGithubWebhook(
        body,
        {
          "x-hub-signature-256": `sha256=${signature}`,
          "x-github-delivery": "123e4567-e89b-12d3-a456-426614174000",
        },
        "secret",
      ),
    ).toBe(true);
    expect(
      verifyGithubWebhook(
        Buffer.from("{}"),
        {
          "x-hub-signature-256": `sha256=${signature}`,
          "x-github-delivery": "123e4567-e89b-12d3-a456-426614174000",
        },
        "secret",
      ),
    ).toBe(false);
    expect(
      providerDeliveryIdentity("github_actions", "github.com", "abc"),
    ).toBe("github_actions:github.com:abc");
  });

  it("supports signed GitLab 19 events and validates legacy token on older hosts", () => {
    const body = Buffer.from('{"object_kind":"pipeline"}');
    const signature = createHmac("sha256", Buffer.alloc(32, 1))
      .update("delivery-1.1780000000.")
      .update(body)
      .digest("base64");
    expect(
      verifyGitlabWebhook(
        body,
        {
          "webhook-signature": `v1,${signature}`,
          "webhook-id": "delivery-1",
          "webhook-timestamp": "1780000000",
        },
        `whsec_${Buffer.alloc(32, 1).toString("base64")}`,
        "signed",
        1780000000,
      ),
    ).toBe(true);
    expect(
      verifyGitlabWebhook(
        body,
        {
          "x-gitlab-token": "secret",
          "x-gitlab-event-uuid": "delivery-1",
        },
        "secret",
        "legacy",
      ),
    ).toBe(true);
    expect(
      verifyGitlabWebhook(
        body,
        {
          "x-gitlab-token": "wrong",
          "x-gitlab-event-uuid": "delivery-1",
        },
        "secret",
        "legacy",
      ),
    ).toBe(false);
    expect(
      verifyGitlabWebhook(
        body,
        {
          "webhook-signature": `v1,${signature}`,
          "webhook-id": "delivery-1",
          "webhook-timestamp": "1780000000",
        },
        `whsec_${Buffer.alloc(32, 1).toString("base64")}`,
        "signed",
        1780000400,
      ),
    ).toBe(false);
  });
});

// Test-only key. Never use fixtures as deployment signing material.
const TEST_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
