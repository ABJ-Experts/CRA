import type { CiProviderReleaseBinding } from "@repo/contracts/sboms";

import { SupabaseService } from "../../supabase/supabase.service";
import { SupabaseSbomRepository } from "./supabase-sbom.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const bindingId = "33333333-3333-4333-8333-333333333333";
const connectorId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const releaseId = "66666666-6666-4666-8666-666666666666";
const credentialId = "77777777-7777-4777-8777-777777777777";
const sourceId = "99999999-9999-4999-8999-999999999999";

function binding(): CiProviderReleaseBinding {
  return {
    id: bindingId,
    connectorId,
    connectionRevision: 1,
    credentialRevision: 1,
    organizationId,
    productId,
    releaseId,
    credentialId,
    provider: "github_actions",
    providerHost: "github.com",
    repositoryOwner: "owner",
    repositoryName: "repo",
    repositoryId: "123",
    providerInstallationId: "456",
    allowedRef: "refs/heads/main",
    projectKey: null,
    pipelineDefinitionId: null,
    status: "active",
    version: 1,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  };
}

describe("SupabaseSbomRepository CI bindings", () => {
  it("includes the connector in a parsed binding and scoped upsert", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "upserted", binding: binding() }],
      error: null,
    });
    const repository = new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);

    await expect(
      repository.upsertBinding(organizationId, actorId, {
        connectorId,
        expectedConnectionRevision: 3,
        expectedCredentialRevision: 2,
        productId,
        releaseId,
        credentialId,
        provider: "github_actions",
        providerHost: "github.com",
        repositoryOwner: "owner",
        repositoryName: "repo",
        repositoryId: "123",
        providerInstallationId: "456",
        allowedRef: "refs/heads/main",
        idempotencyKey: "88888888-8888-4888-8888-888888888888",
      }),
    ).resolves.toMatchObject({
      outcome: "upserted",
      binding: { connectorId },
    });
    expect(rpc).toHaveBeenCalledWith(
      "upsert_ci_provider_release_binding_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_connector_id: connectorId,
        p_expected_connection_revision: 3,
        p_expected_credential_revision: 2,
      }),
    );
  });
});

describe("SupabaseSbomRepository CI atomic intake", () => {
  it("reserves an M3 source and build correlation in one RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "created",
          build_run_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          source: {
            id: sourceId,
            organizationId,
            productId,
            releaseId,
            source: "ci_upload",
            fileName: "build.cdx.json",
            mediaType: "application/json",
            byteSize: 42,
            sha256: "a".repeat(64),
            status: "upload_pending",
            createdAt: "2026-09-30T00:00:00.000Z",
            completedAt: null,
          },
        },
      ],
      error: null,
    });
    const repository = new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    jest.spyOn(repository, "getBinding").mockResolvedValue(binding());
    const verified = {
      bindingId,
      provider: "github_actions" as const,
      providerHost: "github.com",
      repositoryOwner: "owner",
      repositoryName: "repo",
      repositoryId: "123",
      providerInstallationId: "456",
      runId: "42",
      runAttempt: "1",
      ref: "refs/heads/main",
      commitSha: "a".repeat(40),
      eventName: "push" as const,
      observedAt: "2026-09-30T00:00:00.000Z",
    };
    const upload = {
      bindingId,
      runId: "42",
      runAttempt: "1",
      fileName: "build.cdx.json",
      mediaType: "application/json" as const,
      byteSize: 42,
      sha256: "a".repeat(64),
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };

    await expect(
      repository.reserveBuildUpload(
        organizationId,
        credentialId,
        verified,
        upload,
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ),
    ).resolves.toMatchObject({
      outcome: "created",
      reservation: { id: sourceId, releaseId },
      buildRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "reserve_ci_build_sbom_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_credential_id: credentialId,
        p_binding_id: bindingId,
        p_run_id: "42",
        p_declared_sha256: "a".repeat(64),
      }),
    );
    const firstCall = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(firstCall[1].p_request_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(firstCall[1].p_build_digest).toMatch(/^[a-f0-9]{64}$/);
    await repository.reserveBuildUpload(
      organizationId,
      credentialId,
      {
        ...verified,
        repositoryOwner: "renamed-owner",
        repositoryName: "renamed-repo",
      },
      upload,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    const secondCall = rpc.mock.calls[1] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(secondCall[1].p_build_digest).toBe(firstCall[1].p_build_digest);
  });

  it("never reports a passing gate after ingest completes", async () => {
    const data = new Map<string, Record<string, unknown>>([
      [
        "ci_build_runs",
        {
          id: bindingId,
          source_id: sourceId,
          ingest_job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ],
      [
        "sbom_ingest_jobs",
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          source_id: sourceId,
          status: "completed",
          error_code: null,
        },
      ],
      ["sbom_sources", { status: "verified" }],
      [
        "sbom_document_sources",
        { document_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      ],
      ["vulnerability_match_jobs", { status: "completed" }],
    ]);
    const from = jest.fn((table: string) => {
      const query: Record<string, jest.Mock> = {};
      for (const method of ["select", "eq", "is", "order", "limit"])
        query[method] = jest.fn().mockReturnValue(query);
      query.maybeSingle = jest
        .fn()
        .mockResolvedValue({ data: data.get(table), error: null });
      return query;
    });
    const repository = new SupabaseSbomRepository({
      admin: () => ({ from }),
    } as unknown as SupabaseService);
    jest.spyOn(repository, "getBinding").mockResolvedValue(binding());
    await expect(
      repository.gateVerdict(organizationId, credentialId, {
        bindingId,
        runId: "42",
        runAttempt: "1",
      }),
    ).resolves.toMatchObject({
      policy: "unconfigured",
      state: "policy_not_configured",
    });
    expect(from).toHaveBeenCalledWith("sbom_document_sources");
  });

  it("reports a rejected upload as error before any job exists", async () => {
    const from = jest.fn((table: string) => {
      const query: Record<string, jest.Mock> = {};
      for (const method of ["select", "eq"])
        query[method] = jest.fn().mockReturnValue(query);
      query.maybeSingle = jest.fn().mockResolvedValue({
        data:
          table === "ci_build_runs"
            ? { id: bindingId, source_id: sourceId, ingest_job_id: null }
            : { status: "rejected" },
        error: null,
      });
      return query;
    });
    const repository = new SupabaseSbomRepository({
      admin: () => ({ from }),
    } as unknown as SupabaseService);
    jest.spyOn(repository, "getBinding").mockResolvedValue(binding());
    await expect(
      repository.gateVerdict(organizationId, credentialId, {
        bindingId,
        runId: "42",
        runAttempt: "1",
      }),
    ).resolves.toMatchObject({ state: "error" });
  });

  it("reports a revoked binding as error without reading the build", async () => {
    const from = jest.fn();
    const repository = new SupabaseSbomRepository({
      admin: () => ({ from }),
    } as unknown as SupabaseService);
    jest
      .spyOn(repository, "getBinding")
      .mockResolvedValue({ ...binding(), status: "revoked" });
    await expect(
      repository.gateVerdict(organizationId, credentialId, {
        bindingId,
        runId: "42",
        runAttempt: "1",
      }),
    ).resolves.toMatchObject({ state: "error" });
    expect(from).not.toHaveBeenCalled();
  });

  it("finalizes M3 intake and build correlation in one RPC", async () => {
    const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "queued",
          build_run_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          job: {
            id: jobId,
            organizationId,
            releaseId,
            sourceId,
            inputSha256: "a".repeat(64),
            correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            status: "queued",
            progress: { stage: "queued", percent: 0, message: "Queued" },
            attempts: 0,
            maxAttempts: 5,
            error: null,
            result: null,
            createdAt: "2026-09-30T00:00:00.000Z",
            updatedAt: "2026-09-30T00:00:00.000Z",
            completedAt: null,
          },
        },
      ],
      error: null,
    });
    const repository = new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    await expect(
      repository.finalizeBuildUpload(
        organizationId,
        credentialId,
        {
          bindingId,
          provider: "github_actions",
          providerHost: "github.com",
          repositoryOwner: "owner",
          repositoryName: "repo",
          repositoryId: "123",
          providerInstallationId: "456",
          runId: "42",
          runAttempt: "1",
          ref: "refs/heads/main",
          commitSha: "a".repeat(40),
          eventName: "push",
          observedAt: "2026-09-30T00:00:00.000Z",
        },
        sourceId,
        {
          sha256: "a".repeat(64),
          byteSize: 42,
          contentType: "application/json",
        },
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ),
    ).resolves.toMatchObject({
      outcome: "queued",
      job: { id: jobId },
      buildRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "finalize_ci_build_sbom_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_credential_id: credentialId,
        p_binding_id: bindingId,
        p_source_id: sourceId,
        p_run_id: "42",
      }),
    );
  });
});
