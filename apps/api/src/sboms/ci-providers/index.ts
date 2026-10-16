import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

import {
  PinnedCiProviderHttp,
  type CiProviderHttp,
  type CiProviderHttpResponse,
} from "./ci-provider-http";
export type { CiProviderHttp } from "./ci-provider-http";
export {
  providerDeliveryIdentity,
  verifyGithubWebhook,
  verifyGitlabWebhook,
} from "./webhook-verification";

export type CiProvider = "github_actions" | "gitlab_ci" | "azure_devops";

export type CiProviderVerificationInput = Readonly<{
  provider: CiProvider;
  providerHost: string;
  repositoryId: string;
  providerInstallationId?: string;
  projectKey?: string;
  pipelineDefinitionId?: string;
  azureOrganization?: string;
  serviceConnectionId?: string;
  runId: string;
  runAttempt?: string;
  credentials:
    | Readonly<{ kind: "github_app"; appId: string; privateKeyPem: string }>
    | Readonly<{ kind: "gitlab_project_token"; token: string }>
    | Readonly<{ kind: "azure_access_token"; token: string }>;
  approvedHosts?: readonly string[];
}>;

export type CiProviderSetupInput = Omit<
  CiProviderVerificationInput,
  "runId" | "runAttempt"
>;

export type VerifiedCiRun = Readonly<{
  provider: CiProvider;
  providerHost: string;
  repositoryId: string;
  providerInstallationId?: string;
  projectKey?: string;
  pipelineDefinitionId?: string;
  runId: string;
  runAttempt: string;
  commitSha: string;
  ref: string;
  eventName: "push" | "manual" | "release" | "pipeline" | "build";
  observedAt: string;
}>;

export type CiProviderFailure = Readonly<{
  outcome:
    | "untrusted"
    | "not_found"
    | "revoked"
    | "rate_limited"
    | "unavailable"
    | "invalid_configuration";
  retryAfterSeconds?: number;
}>;

export type CiProviderVerificationResult =
  Readonly<{ outcome: "verified"; run: VerifiedCiRun }> | CiProviderFailure;

export type CiProviderSetupResult =
  | Readonly<{
      outcome: "verified";
      repositoryId: string;
      repositoryName: string;
      repositoryOwner: string;
    }>
  | CiProviderFailure;

const numericId = /^[1-9]\d{0,15}$/;
const sha = /^[a-f0-9]{40}$/;
const tagNamePattern = new RegExp("^[A-Za-z0-9][A-Za-z0-9._/-]*$");
const tokenResponse = z.object({ token: z.string().min(1) });
const githubRepository = z.object({
  id: z.number().int().positive(),
  full_name: z.string().regex(/^[^/]+\/[^/]+$/),
});
const githubInstallationRepositories = z.object({
  repositories: z.array(githubRepository).max(100),
});
const githubRun = z.object({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  head_sha: z.string().regex(sha),
  head_branch: z.string().min(1).nullable(),
  event: z.string(),
  repository: z.object({ id: z.number().int().positive() }),
  head_repository: z.object({ id: z.number().int().positive() }).optional(),
  created_at: z.string().datetime({ offset: true }),
});
const gitlabProject = z.object({
  id: z.number().int().positive(),
  path_with_namespace: z.string().regex(/^[^/]+(?:\/[^/]+)+$/),
});
const githubGitObject = z.object({
  type: z.enum(["commit", "tag"]),
  sha: z.string().regex(sha),
});
const githubTagReference = z.object({
  ref: z.string().startsWith("refs/tags/"),
  object: githubGitObject,
});
const githubTagObject = z.object({ object: githubGitObject });
const gitlabPipeline = z.object({
  id: z.number().int().positive(),
  project_id: z.number().int().positive(),
  sha: z.string().regex(sha),
  ref: z.string().min(1),
  tag: z.boolean(),
  source: z.string(),
  created_at: z.string().datetime({ offset: true }),
});
const azureDefinition = z.object({
  id: z.number().int().positive(),
  project: z.object({ id: z.string().uuid() }).optional(),
  repository: z.object({ id: z.string().min(1) }).optional(),
});
const azureBuild = z.object({
  id: z.number().int().positive(),
  definition: z.object({ id: z.number().int().positive() }),
  project: z.object({ id: z.string().uuid() }),
  repository: z.object({ id: z.string().min(1) }),
  sourceVersion: z.string().regex(sha),
  sourceBranch: z.string().min(1),
  reason: z.string(),
  queueTime: z.string().datetime({ offset: true }),
});
const azureEndpoint = z.object({
  id: z.string().uuid(),
  isReady: z.boolean().optional(),
});
const azurePipelinePermissions = z.object({
  allPipelines: z.object({ authorized: z.boolean() }).optional(),
  resource: z.object({ id: z.string(), type: z.string() }),
  pipelines: z.array(
    z.object({ id: z.number().int().positive(), authorized: z.boolean() }),
  ),
});

const validHost = (host: string): boolean =>
  /^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/.test(host) &&
  !host.includes("..") &&
  !host.startsWith("localhost") &&
  !/^\d+\.\d+\.\d+\.\d+$/.test(host);

function configured(input: CiProviderSetupInput): boolean {
  if (!validHost(input.providerHost)) return false;
  if (input.provider === "github_actions")
    return (
      input.providerHost === "github.com" &&
      input.credentials.kind === "github_app" &&
      numericId.test(input.repositoryId) &&
      numericId.test(input.providerInstallationId ?? "") &&
      numericId.test(input.credentials.appId)
    );
  if (input.provider === "gitlab_ci")
    return (
      input.credentials.kind === "gitlab_project_token" &&
      numericId.test(input.repositoryId) &&
      (input.providerHost === "gitlab.com" ||
        input.approvedHosts?.includes(input.providerHost) === true)
    );
  return (
    input.providerHost === "dev.azure.com" &&
    input.credentials.kind === "azure_access_token" &&
    /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(input.azureOrganization ?? "") &&
    z.uuid().safeParse(input.projectKey).success &&
    z.uuid().safeParse(input.serviceConnectionId).success &&
    numericId.test(input.pipelineDefinitionId ?? "") &&
    input.repositoryId.length > 0
  );
}

async function azureConnectionAuthorized(
  input: CiProviderSetupInput,
  http: CiProviderHttp,
): Promise<true | CiProviderFailure> {
  if (input.credentials.kind !== "azure_access_token")
    return { outcome: "invalid_configuration" };
  const prefix = `https://dev.azure.com/${input.azureOrganization}/${input.projectKey}`;
  const headers = { authorization: `Bearer ${input.credentials.token}` };
  const endpointResponse = await request(
    http,
    `${prefix}/_apis/serviceendpoint/endpoints/${input.serviceConnectionId}?api-version=7.1`,
    headers,
    "dev.azure.com",
  );
  if (isFailure(endpointResponse)) return endpointResponse;
  const endpointFailure = classify(endpointResponse);
  if (endpointFailure) return endpointFailure;
  const endpoint = azureEndpoint.safeParse(endpointResponse.body);
  if (
    !endpoint.success ||
    endpoint.data.id !== input.serviceConnectionId ||
    endpoint.data.isReady === false
  )
    return { outcome: "untrusted" };
  const permissionsResponse = await request(
    http,
    `${prefix}/_apis/pipelines/pipelinepermissions/endpoint/${input.serviceConnectionId}?api-version=7.1-preview.1`,
    headers,
    "dev.azure.com",
  );
  if (isFailure(permissionsResponse)) return permissionsResponse;
  const permissionsFailure = classify(permissionsResponse);
  if (permissionsFailure) return permissionsFailure;
  const permissions = azurePipelinePermissions.safeParse(
    permissionsResponse.body,
  );
  if (
    !permissions.success ||
    permissions.data.resource.id !== input.serviceConnectionId ||
    permissions.data.resource.type !== "endpoint" ||
    permissions.data.allPipelines?.authorized === true ||
    !permissions.data.pipelines.some(
      (pipeline) =>
        String(pipeline.id) === input.pipelineDefinitionId &&
        pipeline.authorized,
    ) ||
    permissions.data.pipelines.some(
      (pipeline) =>
        String(pipeline.id) !== input.pipelineDefinitionId &&
        pipeline.authorized,
    )
  )
    return { outcome: "untrusted" };
  return true;
}

function classify(response: CiProviderHttpResponse): CiProviderFailure | null {
  if (response.status >= 200 && response.status < 300) return null;
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers["retry-after"] !== undefined ||
        response.headers["x-ratelimit-remaining"] === "0"))
  ) {
    const retry = Number(response.headers["retry-after"]);
    return {
      outcome: "rate_limited",
      ...(Number.isInteger(retry) && retry >= 0 && retry <= 3600
        ? { retryAfterSeconds: retry }
        : {}),
    };
  }
  if (response.status === 401 || response.status === 403)
    return { outcome: "revoked" };
  if (response.status === 404) return { outcome: "not_found" };
  return { outcome: "unavailable" };
}

async function githubToken(
  input: CiProviderSetupInput,
  http: CiProviderHttp,
): Promise<string | CiProviderFailure> {
  if (input.credentials.kind !== "github_app")
    return { outcome: "invalid_configuration" };
  try {
    const key = await importPKCS8(input.credentials.privateKeyPem, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 540)
      .setIssuer(input.credentials.appId)
      .sign(key);
    const response = await http.request({
      url: `https://api.github.com/app/installations/${input.providerInstallationId}/access_tokens`,
      method: "POST",
      allowedHosts: ["api.github.com"],
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repository_ids: [Number(input.repositoryId)],
        permissions: { actions: "read", metadata: "read", contents: "read" },
      }),
    });
    const failure = classify(response);
    if (failure) return failure;
    const parsed = tokenResponse.safeParse(response.body);
    return parsed.success ? parsed.data.token : { outcome: "unavailable" };
  } catch {
    return { outcome: "unavailable" };
  }
}

async function request(
  http: CiProviderHttp,
  url: string,
  headers: Readonly<Record<string, string>>,
  host: string,
): Promise<CiProviderHttpResponse | CiProviderFailure> {
  try {
    return await http.request({ url, headers, allowedHosts: [host] });
  } catch {
    return { outcome: "unavailable" };
  }
}

const isFailure = (
  result: CiProviderHttpResponse | CiProviderFailure,
): result is CiProviderFailure => "outcome" in result;

async function githubRepositoryLookup(
  input: CiProviderSetupInput,
  http: CiProviderHttp,
): Promise<
  Readonly<{ token: string; owner: string; name: string }> | CiProviderFailure
> {
  const token = await githubToken(input, http);
  if (typeof token !== "string") return token;
  const response = await request(
    http,
    "https://api.github.com/installation/repositories?per_page=100",
    {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    "api.github.com",
  );
  if (isFailure(response)) return response;
  const failure = classify(response);
  if (failure) return failure;
  const repositories = githubInstallationRepositories.safeParse(response.body);
  if (!repositories.success || repositories.data.repositories.length !== 1)
    return { outcome: "untrusted" };
  const repo = repositories.data.repositories[0];
  if (!repo || String(repo.id) !== input.repositoryId)
    return { outcome: "untrusted" };
  const [owner, name] = repo.full_name.split("/") as [string, string];
  return { token, owner, name };
}

async function githubReleaseRef(
  http: CiProviderHttp,
  lookup: Readonly<{ token: string; owner: string; name: string }>,
  tagName: string,
  commitSha: string,
): Promise<string | CiProviderFailure> {
  if (
    tagName.length > 200 ||
    tagName.startsWith("/") ||
    tagName.endsWith("/") ||
    tagName.includes("..") ||
    !tagNamePattern.test(tagName)
  )
    return { outcome: "untrusted" };
  const prefix = `https://api.github.com/repos/${encodeURIComponent(lookup.owner)}/${encodeURIComponent(lookup.name)}`;
  const headers = {
    authorization: `Bearer ${lookup.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const response = await request(
    http,
    `${prefix}/git/ref/tags/${encodeURIComponent(tagName)}`,
    headers,
    "api.github.com",
  );
  if (isFailure(response)) return response;
  const failure = classify(response);
  if (failure)
    return failure.outcome === "not_found" ? { outcome: "untrusted" } : failure;
  const reference = githubTagReference.safeParse(response.body);
  if (!reference.success || reference.data.ref !== `refs/tags/${tagName}`)
    return { outcome: "untrusted" };
  let object = reference.data.object;
  for (let depth = 0; depth < 3 && object.type === "tag"; depth += 1) {
    const tagResponse = await request(
      http,
      `${prefix}/git/tags/${object.sha}`,
      headers,
      "api.github.com",
    );
    if (isFailure(tagResponse)) return tagResponse;
    const tagFailure = classify(tagResponse);
    if (tagFailure)
      return tagFailure.outcome === "not_found"
        ? { outcome: "untrusted" }
        : tagFailure;
    const parsed = githubTagObject.safeParse(tagResponse.body);
    if (!parsed.success) return { outcome: "untrusted" };
    object = parsed.data.object;
  }
  return object.type === "commit" && object.sha === commitSha
    ? `refs/tags/${tagName}`
    : { outcome: "untrusted" };
}

export async function verifyCiRepository(
  input: CiProviderSetupInput,
  http: CiProviderHttp = new PinnedCiProviderHttp(),
): Promise<CiProviderSetupResult> {
  if (!configured(input)) return { outcome: "invalid_configuration" };
  if (input.provider === "github_actions") {
    const lookup = await githubRepositoryLookup(input, http);
    if ("outcome" in lookup) return lookup;
    return {
      outcome: "verified",
      repositoryId: input.repositoryId,
      repositoryOwner: lookup.owner,
      repositoryName: lookup.name,
    };
  }
  if (input.provider === "gitlab_ci") {
    if (input.credentials.kind !== "gitlab_project_token")
      return { outcome: "invalid_configuration" };
    const response = await request(
      http,
      `https://${input.providerHost}/api/v4/projects/${input.repositoryId}`,
      { "private-token": input.credentials.token },
      input.providerHost,
    );
    if (isFailure(response)) return response;
    const failure = classify(response);
    if (failure) return failure;
    const project = gitlabProject.safeParse(response.body);
    if (!project.success || String(project.data.id) !== input.repositoryId)
      return { outcome: "untrusted" };
    const path = project.data.path_with_namespace.split("/");
    return {
      outcome: "verified",
      repositoryId: input.repositoryId,
      repositoryOwner: path.slice(0, -1).join("/"),
      repositoryName: path.at(-1) ?? "",
    };
  }
  if (input.credentials.kind !== "azure_access_token")
    return { outcome: "invalid_configuration" };
  const connection = await azureConnectionAuthorized(input, http);
  if (connection !== true) return connection;
  const response = await request(
    http,
    `https://dev.azure.com/${input.azureOrganization}/${input.projectKey}/_apis/build/definitions/${input.pipelineDefinitionId}?api-version=7.1`,
    { authorization: `Bearer ${input.credentials.token}` },
    "dev.azure.com",
  );
  if (isFailure(response)) return response;
  const failure = classify(response);
  if (failure) return failure;
  const definition = azureDefinition.safeParse(response.body);
  if (
    !definition.success ||
    String(definition.data.id) !== input.pipelineDefinitionId ||
    definition.data.project?.id !== input.projectKey ||
    definition.data.repository?.id !== input.repositoryId
  )
    return { outcome: "untrusted" };
  return {
    outcome: "verified",
    repositoryId: input.repositoryId,
    repositoryOwner: input.azureOrganization ?? "",
    repositoryName: input.repositoryId,
  };
}

export async function verifyCiRun(
  input: CiProviderVerificationInput,
  http: CiProviderHttp = new PinnedCiProviderHttp(),
): Promise<CiProviderVerificationResult> {
  if (
    !configured(input) ||
    !numericId.test(input.runId) ||
    (input.runAttempt !== undefined && !numericId.test(input.runAttempt))
  )
    return { outcome: "invalid_configuration" };
  if (input.provider === "github_actions") {
    const lookup = await githubRepositoryLookup(input, http);
    if ("outcome" in lookup) return lookup;
    const response = await request(
      http,
      `https://api.github.com/repos/${encodeURIComponent(lookup.owner)}/${encodeURIComponent(lookup.name)}/actions/runs/${input.runId}`,
      {
        authorization: `Bearer ${lookup.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      "api.github.com",
    );
    if (isFailure(response)) return response;
    const failure = classify(response);
    if (failure) return failure;
    const parsed = githubRun.safeParse(response.body);
    if (!parsed.success) return { outcome: "unavailable" };
    const run = parsed.data;
    if (
      String(run.id) !== input.runId ||
      String(run.repository.id) !== input.repositoryId ||
      (input.runAttempt !== undefined &&
        String(run.run_attempt) !== input.runAttempt) ||
      (run.head_repository && run.head_repository.id !== run.repository.id) ||
      !["push", "release"].includes(run.event) ||
      !run.head_branch
    )
      return { outcome: "untrusted" };
    const ref =
      run.event === "release"
        ? await githubReleaseRef(http, lookup, run.head_branch, run.head_sha)
        : `refs/heads/${run.head_branch}`;
    if (typeof ref !== "string") return ref;
    return {
      outcome: "verified",
      run: {
        provider: input.provider,
        providerHost: input.providerHost,
        repositoryId: input.repositoryId,
        providerInstallationId: input.providerInstallationId,
        runId: input.runId,
        runAttempt: String(run.run_attempt),
        commitSha: run.head_sha,
        ref,
        eventName: run.event === "release" ? "release" : "push",
        observedAt: run.created_at,
      },
    };
  }
  if (input.provider === "gitlab_ci") {
    if (input.credentials.kind !== "gitlab_project_token")
      return { outcome: "invalid_configuration" };
    const response = await request(
      http,
      `https://${input.providerHost}/api/v4/projects/${input.repositoryId}/pipelines/${input.runId}`,
      { "private-token": input.credentials.token },
      input.providerHost,
    );
    if (isFailure(response)) return response;
    const failure = classify(response);
    if (failure) return failure;
    const parsed = gitlabPipeline.safeParse(response.body);
    if (!parsed.success) return { outcome: "unavailable" };
    const pipeline = parsed.data;
    if (
      String(pipeline.id) !== input.runId ||
      String(pipeline.project_id) !== input.repositoryId ||
      pipeline.source !== "push" ||
      (input.runAttempt !== undefined && input.runAttempt !== "1")
    )
      return { outcome: "untrusted" };
    return {
      outcome: "verified",
      run: {
        provider: input.provider,
        providerHost: input.providerHost,
        repositoryId: input.repositoryId,
        runId: input.runId,
        runAttempt: "1",
        commitSha: pipeline.sha,
        ref: `${pipeline.tag ? "refs/tags" : "refs/heads"}/${pipeline.ref}`,
        eventName: "push",
        observedAt: pipeline.created_at,
      },
    };
  }
  if (input.credentials.kind !== "azure_access_token")
    return { outcome: "invalid_configuration" };
  const connection = await azureConnectionAuthorized(input, http);
  if (connection !== true) return connection;
  const response = await request(
    http,
    `https://dev.azure.com/${input.azureOrganization}/${input.projectKey}/_apis/build/builds/${input.runId}?api-version=7.1`,
    { authorization: `Bearer ${input.credentials.token}` },
    "dev.azure.com",
  );
  if (isFailure(response)) return response;
  const failure = classify(response);
  if (failure) return failure;
  const parsed = azureBuild.safeParse(response.body);
  if (!parsed.success) return { outcome: "unavailable" };
  const build = parsed.data;
  if (
    String(build.id) !== input.runId ||
    String(build.definition.id) !== input.pipelineDefinitionId ||
    build.project.id !== input.projectKey ||
    build.repository.id !== input.repositoryId ||
    !["individualCI", "batchedCI", "manual"].includes(build.reason) ||
    build.sourceBranch.startsWith("refs/pull/") ||
    (input.runAttempt !== undefined && input.runAttempt !== "1")
  )
    return { outcome: "untrusted" };
  return {
    outcome: "verified",
    run: {
      provider: input.provider,
      providerHost: input.providerHost,
      repositoryId: input.repositoryId,
      projectKey: input.projectKey,
      pipelineDefinitionId: input.pipelineDefinitionId,
      runId: input.runId,
      runAttempt: "1",
      commitSha: build.sourceVersion,
      ref: build.sourceBranch,
      eventName: build.reason === "manual" ? "manual" : "build",
      observedAt: build.queueTime,
    },
  };
}
