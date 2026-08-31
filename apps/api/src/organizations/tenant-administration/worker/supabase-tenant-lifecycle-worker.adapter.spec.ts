import {
  SupabaseTenantExportSourceAdapter,
  SupabaseTenantLifecycleStorageAdapter,
  SupabaseTenantLifecycleWorkerRepository,
  UnavailableEvidenceCleanupAdapter,
} from "./supabase-tenant-lifecycle-worker.adapter";

const organizationId = "00000000-0000-4000-8000-000000000001";

const configuration = (maximumArchiveBytes = 47_000_000) =>
  ({ getOrThrow: jest.fn().mockReturnValue(maximumArchiveBytes) }) as never;

const jobId = "00000000-0000-4000-8000-000000000010";
const workId = "00000000-0000-4000-8000-000000000011";
const workerId = "00000000-0000-4000-8000-000000000012";
const sha256 = "a".repeat(64);

type ProviderResult = Readonly<{ data: unknown; error: unknown }>;

function workerRepositoryHarness(
  input: {
    rpc?: Readonly<Record<string, readonly ProviderResult[]>>;
    tables?: Readonly<Record<string, readonly ProviderResult[]>>;
  } = {},
) {
  const rpcQueues = new Map(
    Object.entries(input.rpc ?? {}).map(([name, responses]) => [
      name,
      [...responses],
    ]),
  );
  const tableQueues = new Map(
    Object.entries(input.tables ?? {}).map(([name, responses]) => [
      name,
      [...responses],
    ]),
  );
  const take = (
    queues: Map<string, ProviderResult[]>,
    key: string,
  ): ProviderResult => queues.get(key)?.shift() ?? { data: [], error: null };
  const from = jest.fn((table: string) => {
    const builder = {
      select: jest.fn(),
      eq: jest.fn(),
      in: jest.fn(),
      lte: jest.fn(),
      limit: jest.fn(),
      order: jest.fn(),
      maybeSingle: jest.fn(),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.in.mockReturnValue(builder);
    builder.lte.mockReturnValue(builder);
    builder.limit.mockImplementation(() =>
      Promise.resolve(take(tableQueues, table)),
    );
    builder.order.mockImplementation(() =>
      Promise.resolve(take(tableQueues, table)),
    );
    builder.maybeSingle.mockImplementation(() =>
      Promise.resolve(take(tableQueues, table)),
    );
    return builder;
  });
  const rpc = jest.fn((name: string) => Promise.resolve(take(rpcQueues, name)));
  const repository = new SupabaseTenantLifecycleWorkerRepository({
    admin: () => ({ from, rpc }),
  } as never);
  return { repository, from, rpc };
}

describe("SupabaseTenantExportSourceAdapter", () => {
  it("exports only SQL-materialized, redacted snapshot records with org/export/source filters", async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
      range: jest.fn().mockResolvedValue({
        data: [
          {
            table_name: "invitations",
            table_sort: 1,
            record_index: 1,
            record_payload: {
              id: "00000000-0000-4000-8000-000000000002",
              organization_id: organizationId,
              email: "member@cra.test",
              metadata: { display: "safe" },
            },
          },
        ],
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValueOnce(query).mockImplementation(() => query);
    const from = jest.fn().mockReturnValue(query);
    const adapter = new SupabaseTenantExportSourceAdapter(
      {
        admin: () => ({ from }),
      } as never,
      configuration(),
    );

    const bytes = await adapter.read(organizationId, jobId, "invitations");
    const exported = bytes.toString("utf8");

    expect(from).toHaveBeenCalledWith("organization_export_snapshot_records");
    expect(query.eq).toHaveBeenCalledWith("organization_id", organizationId);
    expect(query.eq).toHaveBeenCalledWith("export_job_id", jobId);
    expect(query.eq).toHaveBeenCalledWith("source_id", "invitations");
    expect(query.range).toHaveBeenCalledWith(0, 999);
    expect(exported).toContain('"display":"safe"');
    expect(exported).not.toContain("token_hash");
  });

  it("reads every page instead of silently accepting the provider default row limit", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      table_name: "invitations",
      table_sort: 1,
      record_index: index + 1,
      record_payload: { id: `record-${index}` },
    }));
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
      range: jest
        .fn()
        .mockResolvedValueOnce({ data: firstPage, error: null })
        .mockResolvedValueOnce({
          data: [
            {
              table_name: "invitations",
              table_sort: 1,
              record_index: 1001,
              record_payload: { id: "record-1000" },
            },
          ],
          error: null,
        }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValueOnce(query).mockImplementation(() => query);
    const adapter = new SupabaseTenantExportSourceAdapter(
      {
        admin: () => ({ from: () => query }),
      } as never,
      configuration(),
    );

    const lines = (await adapter.read(organizationId, jobId, "invitations"))
      .toString("utf8")
      .trimEnd()
      .split("\n");

    expect(lines).toHaveLength(1001);
    expect(query.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(query.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("stops a source at the configured worker archive limit instead of growing process memory indefinitely", async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
      range: jest.fn().mockResolvedValue({
        data: [
          {
            table_name: "invitations",
            table_sort: 1,
            record_index: 1,
            record_payload: { id: "record-1" },
          },
        ],
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValueOnce(query).mockImplementation(() => query);
    const adapter = new SupabaseTenantExportSourceAdapter(
      { admin: () => ({ from: () => query }) } as never,
      configuration(1),
    );

    await expect(
      adapter.read(organizationId, jobId, "invitations"),
    ).rejects.toMatchObject({
      code: "export_size_limit",
      retryable: false,
    });
  });

  it("maps a raw paged-source provider interruption to a retryable safe failure", async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
      range: jest.fn().mockRejectedValue(new Error("private provider failure")),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValueOnce(query).mockImplementation(() => query);
    const adapter = new SupabaseTenantExportSourceAdapter(
      { admin: () => ({ from: () => query }) } as never,
      configuration(),
    );

    await expect(
      adapter.read(organizationId, jobId, "invitations"),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });

  it("fails closed if a supposedly redacted snapshot payload contains a secret-shaped key", async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
      range: jest.fn().mockResolvedValue({
        data: [
          {
            table_name: "invitations",
            table_sort: 1,
            record_index: 1,
            record_payload: { metadata: { recovery_code: "forbidden" } },
          },
        ],
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValueOnce(query).mockImplementation(() => query);
    const adapter = new SupabaseTenantExportSourceAdapter(
      { admin: () => ({ from: () => query }) } as never,
      configuration(),
    );

    await expect(
      adapter.read(organizationId, jobId, "invitations"),
    ).rejects.toMatchObject({
      code: "snapshot_sensitive_payload",
      retryable: false,
    });
  });
});

describe("SupabaseTenantLifecycleWorkerRepository", () => {
  it("uses org-first RPCs for the complete export job lifecycle and validates durable parts", async () => {
    const { repository, rpc } = workerRepositoryHarness({
      rpc: {
        claim_organization_export_atomic: [
          {
            data: [
              {
                outcome: "claimed",
                export_job_id: jobId,
                lease_owner: workerId,
                checkpoint_version: 2,
                snapshot: { sourceIds: ["organization_profile"] },
              },
            ],
            error: null,
          },
        ],
        materialize_organization_export_snapshot_atomic: [
          {
            data: [{ outcome: "materialized", checkpoint_version: 2 }],
            error: null,
          },
        ],
        checkpoint_organization_export_atomic: [
          {
            data: [{ outcome: "checkpointed", checkpoint_version: 3 }],
            error: null,
          },
        ],
        complete_organization_export_atomic: [
          { data: [{ outcome: "completed" }], error: null },
        ],
        fail_organization_export_atomic: [
          { data: [{ outcome: "recorded" }], error: null },
        ],
      },
      tables: {
        organization_export_jobs: [
          { data: [{ organization_id: organizationId }], error: null },
          {
            data: {
              actor_user_id: workerId,
              created_at: "2026-08-10T00:00:00.000Z",
            },
            error: null,
          },
        ],
        organization_export_parts: [
          {
            data: [
              {
                source_id: "organization_profile",
                part_number: 1,
                object_path: "part.ndjson",
                sha256,
                byte_size: 5,
              },
            ],
            error: null,
          },
        ],
      },
    });

    await expect(repository.export.dueOrganizationIds()).resolves.toEqual([
      organizationId,
    ]);
    await expect(
      repository.export.claim(organizationId, workerId, 60),
    ).resolves.toEqual({
      outcome: "claimed",
      jobId,
      leaseOwner: workerId,
      checkpointVersion: 2,
      sourceIds: ["organization_profile"],
    });
    await expect(
      repository.export.parts(organizationId, jobId),
    ).resolves.toEqual([
      {
        sourceId: "organization_profile",
        partNumber: 1,
        objectPath: "part.ndjson",
        sha256,
        byteSize: 5,
      },
    ]);
    await expect(
      repository.export.materialize({
        organizationId,
        exportId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 2,
      }),
    ).resolves.toEqual({ outcome: "materialized", checkpointVersion: 2 });
    await expect(
      repository.export.context(organizationId, jobId),
    ).resolves.toEqual({
      actorId: workerId,
      requestedAt: "2026-08-10T00:00:00.000Z",
    });
    await expect(
      repository.export.checkpoint({
        organizationId,
        exportId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 2,
        completedParts: 1,
        totalParts: 1,
        parts: [
          {
            sourceId: "organization_profile",
            partNumber: 1,
            objectPath: "part.ndjson",
            sha256,
            byteSize: 5,
          },
        ],
      }),
    ).resolves.toEqual({ outcome: "checkpointed", checkpointVersion: 3 });
    await expect(
      repository.export.complete({
        organizationId,
        exportId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 3,
        manifestFileCount: 1,
        manifestSha256: sha256,
        artifactSha256: sha256,
        artifactObjectPath: "export.zip",
      }),
    ).resolves.toEqual({ outcome: "completed" });
    await repository.export.fail({
      organizationId,
      exportId: jobId,
      leaseOwner: workerId,
      checkpointVersion: 3,
      code: "provider_unavailable",
      retryable: true,
    });

    expect(rpc).toHaveBeenCalledWith(
      "claim_organization_export_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "materialize_organization_export_snapshot_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_export_job_id: jobId,
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "fail_organization_export_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_safe_diagnostics: { code: "provider_unavailable" },
      }),
    );
  });

  it("claims cleanup work with an exact org-scoped pending item set and persists its result", async () => {
    const itemId = "00000000-0000-4000-8000-000000000013";
    const recordId = "00000000-0000-4000-8000-000000000014";
    const { repository, rpc } = workerRepositoryHarness({
      rpc: {
        claim_retention_cleanup_atomic: [
          {
            data: [
              {
                outcome: "claimed",
                cleanup_run_id: jobId,
                lease_owner: workerId,
                checkpoint_version: 1,
              },
            ],
            error: null,
          },
        ],
        complete_retention_cleanup_atomic: [
          { data: [{ outcome: "completed" }], error: null },
        ],
        fail_retention_cleanup_atomic: [
          { data: [{ outcome: "recorded" }], error: null },
        ],
      },
      tables: {
        retention_cleanup_runs: [
          { data: { evidence_class: "audit_event" }, error: null },
        ],
        retention_cleanup_items: [
          { data: [{ id: itemId, source_record_id: recordId }], error: null },
        ],
      },
    });

    await expect(
      repository.cleanup.claim(organizationId, workerId, 60),
    ).resolves.toEqual({
      outcome: "claimed",
      runId: jobId,
      leaseOwner: workerId,
      checkpointVersion: 1,
      evidenceClass: "audit_event",
      items: [{ itemId, sourceRecordId: recordId }],
    });
    await expect(
      repository.cleanup.complete({
        organizationId,
        runId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 1,
        results: [{ itemId, status: "deleted" }],
      }),
    ).resolves.toEqual({ outcome: "completed" });
    await repository.cleanup.fail({
      organizationId,
      runId: jobId,
      leaseOwner: workerId,
      checkpointVersion: 1,
      code: "dependency_unavailable",
      retryable: true,
    });

    expect(rpc).toHaveBeenCalledWith(
      "complete_retention_cleanup_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_item_results: [{ itemId, status: "deleted" }],
      }),
    );
  });

  it("maps purge and post-deletion artifact leases through their durable RPCs", async () => {
    const { repository, rpc } = workerRepositoryHarness({
      rpc: {
        claim_organization_purge_atomic: [
          {
            data: [
              {
                outcome: "claimed",
                purge_job_id: jobId,
                lease_owner: workerId,
                checkpoint_version: 4,
              },
            ],
            error: null,
          },
        ],
        complete_organization_purge_atomic: [
          { data: [{ outcome: "purged" }], error: null },
        ],
        fail_organization_purge_atomic: [
          { data: [{ outcome: "recorded" }], error: null },
        ],
        claim_organization_deletion_artifact_work_atomic: [
          {
            data: [
              {
                outcome: "claimed",
                work_id: workId,
                object_prefix: `${organizationId}/`,
              },
            ],
            error: null,
          },
        ],
        complete_organization_deletion_artifact_work_atomic: [
          { data: [{ outcome: "completed" }], error: null },
        ],
        fail_organization_deletion_artifact_work_atomic: [
          { data: [{ outcome: "recorded" }], error: null },
        ],
      },
    });

    await expect(
      repository.purge.claim(organizationId, workerId, 60),
    ).resolves.toEqual({
      outcome: "claimed",
      jobId,
      leaseOwner: workerId,
      checkpointVersion: 4,
    });
    await expect(
      repository.purge.complete({
        organizationId,
        purgeJobId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 4,
      }),
    ).resolves.toEqual({ outcome: "purged" });
    await repository.purge.fail({
      organizationId,
      purgeJobId: jobId,
      leaseOwner: workerId,
      checkpointVersion: 4,
      code: "provider_unavailable",
      retryable: true,
    });
    await expect(repository.artifactWork.claim(workerId, 60)).resolves.toEqual({
      outcome: "claimed",
      workId,
      objectPrefix: `${organizationId}/`,
    });
    await expect(
      repository.artifactWork.complete(workId, workerId),
    ).resolves.toEqual({ outcome: "completed" });
    await repository.artifactWork.fail({
      workId,
      leaseOwner: workerId,
      code: "provider_unavailable",
      retryable: true,
    });

    expect(rpc).toHaveBeenCalledWith(
      "claim_organization_purge_atomic",
      expect.objectContaining({ p_organization_id: organizationId }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "fail_organization_deletion_artifact_work_atomic",
      {
        p_work_id: workId,
        p_lease_owner: workerId,
        p_safe_error_code: "provider_unavailable",
        p_retryable: true,
      },
    );
  });

  it("returns only declared non-claim outcomes and treats malformed provider payloads as safe failures", async () => {
    const safe = workerRepositoryHarness({
      rpc: {
        claim_organization_export_atomic: [
          { data: [{ outcome: "none_available" }], error: null },
        ],
        claim_retention_cleanup_atomic: [
          { data: [{ outcome: "blocked" }], error: null },
        ],
        claim_organization_purge_atomic: [
          { data: [{ outcome: "invalid_state" }], error: null },
        ],
        claim_organization_deletion_artifact_work_atomic: [
          { data: [{ outcome: "none_available" }], error: null },
        ],
      },
    }).repository;
    await expect(
      safe.export.claim(organizationId, workerId, 60),
    ).resolves.toEqual({ outcome: "none_available" });
    await expect(
      safe.cleanup.claim(organizationId, workerId, 60),
    ).resolves.toEqual({ outcome: "blocked" });
    await expect(
      safe.purge.claim(organizationId, workerId, 60),
    ).resolves.toEqual({ outcome: "invalid_state" });
    await expect(safe.artifactWork.claim(workerId, 60)).resolves.toEqual({
      outcome: "none_available",
    });

    const malformed = workerRepositoryHarness({
      rpc: {
        claim_organization_export_atomic: [
          {
            data: [
              {
                outcome: "claimed",
                export_job_id: jobId,
                lease_owner: workerId,
                checkpoint_version: 0,
                snapshot: { sourceIds: [] },
              },
            ],
            error: null,
          },
        ],
      },
    }).repository;
    await expect(
      malformed.export.claim(organizationId, workerId, 60),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });

  it("maps provider failures to retryable safe diagnostics without retaining their payload", async () => {
    const repository = workerRepositoryHarness({
      rpc: {
        claim_organization_export_atomic: [
          { data: null, error: { message: "private provider exception" } },
        ],
      },
    }).repository;

    await expect(
      repository.export.claim(organizationId, workerId, 60),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });

  it("rejects malformed persisted export parts rather than constructing a trusted ledger", async () => {
    const repository = workerRepositoryHarness({
      tables: {
        organization_export_parts: [
          {
            data: [
              {
                source_id: "organization_profile",
                part_number: 0,
                object_path: "part",
                sha256,
                byte_size: 1,
              },
            ],
            error: null,
          },
        ],
      },
    }).repository;

    await expect(
      repository.export.parts(organizationId, jobId),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });

  it("rejects undeclared state transitions and lists only valid due organization identifiers", async () => {
    const { repository } = workerRepositoryHarness({
      rpc: {
        checkpoint_organization_export_atomic: [
          { data: [{ outcome: "future" }], error: null },
        ],
        complete_organization_export_atomic: [
          { data: [{ outcome: "future" }], error: null },
        ],
        complete_retention_cleanup_atomic: [
          { data: [{ outcome: "future" }], error: null },
        ],
        complete_organization_purge_atomic: [
          { data: [{ outcome: "future" }], error: null },
        ],
        complete_organization_deletion_artifact_work_atomic: [
          { data: [{ outcome: "future" }], error: null },
        ],
      },
      tables: {
        organization_export_jobs: [
          {
            data: [
              { organization_id: organizationId },
              { organization_id: "not-a-uuid" },
            ],
            error: null,
          },
        ],
        retention_cleanup_runs: [{ data: [], error: null }],
        organization_purge_jobs: [{ data: [], error: null }],
      },
    });
    await expect(repository.export.dueOrganizationIds()).resolves.toEqual([
      organizationId,
    ]);
    await expect(repository.cleanup.dueOrganizationIds()).resolves.toEqual([]);
    await expect(repository.purge.dueOrganizationIds()).resolves.toEqual([]);
    await expect(
      repository.export.checkpoint({
        organizationId,
        exportId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 0,
        completedParts: 1,
        totalParts: 1,
        parts: [
          {
            sourceId: "organization_profile",
            partNumber: 1,
            objectPath: "part",
            sha256,
            byteSize: 1,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      repository.export.complete({
        organizationId,
        exportId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 0,
        manifestFileCount: 1,
        manifestSha256: sha256,
        artifactSha256: sha256,
        artifactObjectPath: "archive",
      }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      repository.cleanup.complete({
        organizationId,
        runId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 0,
        results: [],
      }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      repository.purge.complete({
        organizationId,
        purgeJobId: jobId,
        leaseOwner: workerId,
        checkpointVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      repository.artifactWork.complete(workId, workerId),
    ).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("fails closed on malformed context, cleanup, purge, and artifact-work claims", async () => {
    const context = workerRepositoryHarness({
      tables: {
        organization_export_jobs: [
          {
            data: { actor_user_id: "not-a-uuid", created_at: 10 },
            error: null,
          },
        ],
      },
    }).repository;
    await expect(
      context.export.context(organizationId, jobId),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });

    const cleanup = workerRepositoryHarness({
      rpc: {
        claim_retention_cleanup_atomic: [
          {
            data: [
              {
                outcome: "claimed",
                cleanup_run_id: "not-a-uuid",
                lease_owner: workerId,
                checkpoint_version: 0,
              },
            ],
            error: null,
          },
        ],
      },
    }).repository;
    await expect(
      cleanup.cleanup.claim(organizationId, workerId, 60),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });

    const purge = workerRepositoryHarness({
      rpc: {
        claim_organization_purge_atomic: [
          {
            data: [
              {
                outcome: "claimed",
                purge_job_id: jobId,
                lease_owner: workerId,
                checkpoint_version: "0",
              },
            ],
            error: null,
          },
        ],
      },
    }).repository;
    await expect(
      purge.purge.claim(organizationId, workerId, 60),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });

    const artifact = workerRepositoryHarness({
      rpc: {
        claim_organization_deletion_artifact_work_atomic: [
          { data: [{ outcome: "invalid_state" }], error: null },
          {
            data: [
              { outcome: "claimed", work_id: "not-a-uuid", object_prefix: "" },
            ],
            error: null,
          },
        ],
      },
    }).repository;
    await expect(
      artifact.artifactWork.claim(workerId, 60),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
    await expect(
      artifact.artifactWork.claim(workerId, 60),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });

  it("does not trust malformed singleton RPC rows or malformed global scheduling metadata", async () => {
    const invalidOutcome = workerRepositoryHarness({
      rpc: {
        claim_organization_export_atomic: [
          { data: [{ outcome: "future" }], error: null },
          { data: [], error: null },
        ],
      },
    }).repository;
    await expect(
      invalidOutcome.export.claim(organizationId, workerId, 60),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
    await expect(
      invalidOutcome.export.claim(organizationId, workerId, 60),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });

    const invalidSchedule = workerRepositoryHarness({
      tables: { organization_export_jobs: [{ data: [null], error: null }] },
    }).repository;
    await expect(
      invalidSchedule.export.dueOrganizationIds(),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });
});

describe("SupabaseTenantLifecycleStorageAdapter", () => {
  it("reads, writes, inventories recursively, and deletes private artifact prefixes in bounded batches", async () => {
    const download = jest.fn().mockResolvedValue({
      data: {
        arrayBuffer: () =>
          Promise.resolve(Uint8Array.from(Buffer.from("part")).buffer),
      },
      error: null,
    });
    const upload = jest.fn().mockResolvedValue({ error: null });
    const list = jest.fn((prefix: string) =>
      Promise.resolve({
        data:
          prefix === `${organizationId}/`
            ? [
                { name: "parts", id: null },
                { name: "manifest.json", id: "object" },
              ]
            : [{ name: "part.ndjson", id: "object" }],
        error: null,
      }),
    );
    const remove = jest.fn().mockResolvedValue({ error: null });
    const storage = new SupabaseTenantLifecycleStorageAdapter({
      admin: () => ({
        storage: { from: () => ({ download, upload, list, remove }) },
      }),
    } as never);

    await expect(storage.read("part.ndjson")).resolves.toEqual(
      Buffer.from("part"),
    );
    await storage.write(
      "part.ndjson",
      Buffer.from("part"),
      "application/x-ndjson",
    );
    await expect(storage.inventory(organizationId)).resolves.toEqual([
      `${organizationId}/manifest.json`,
      `${organizationId}/parts/part.ndjson`,
    ]);
    await storage.deletePrefix(`${organizationId}/`);

    expect(upload).toHaveBeenCalledWith("part.ndjson", Buffer.from("part"), {
      contentType: "application/x-ndjson",
      upsert: true,
    });
    expect(remove).toHaveBeenCalledWith([
      `${organizationId}/manifest.json`,
      `${organizationId}/parts/part.ndjson`,
    ]);
  });

  it("distinguishes missing objects from malformed or unavailable storage responses", async () => {
    const missing = new SupabaseTenantLifecycleStorageAdapter({
      admin: () => ({
        storage: {
          from: () => ({
            download: () =>
              Promise.resolve({
                data: null,
                error: { message: "missing" },
              }),
          }),
        },
      }),
    } as never);
    await expect(missing.read("missing")).resolves.toBeNull();

    const malformed = new SupabaseTenantLifecycleStorageAdapter({
      admin: () => ({
        storage: {
          from: () => ({
            download: () => Promise.resolve({ data: null, error: null }),
          }),
        },
      }),
    } as never);
    await expect(malformed.read("malformed")).rejects.toMatchObject({
      code: "malformed_provider",
    });

    const unavailable = new SupabaseTenantLifecycleStorageAdapter({
      admin: () => ({
        storage: {
          from: () => ({
            upload: () =>
              Promise.resolve({ error: { message: "private outage" } }),
          }),
        },
      }),
    } as never);
    await expect(
      unavailable.write("part", Buffer.from("x")),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });

  it("rejects malformed list names before composing an artifact deletion path", async () => {
    const storage = new SupabaseTenantLifecycleStorageAdapter({
      admin: () => ({
        storage: {
          from: () => ({
            list: () =>
              Promise.resolve({
                data: [{ name: "../escape", id: "object" }],
                error: null,
              }),
          }),
        },
      }),
    } as never);

    await expect(storage.inventory(organizationId)).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });

  it("wraps list provider interruptions as retryable failures", async () => {
    const storage = new SupabaseTenantLifecycleStorageAdapter({
      admin: () => ({
        storage: {
          from: () => ({
            list: () =>
              Promise.resolve({
                data: null,
                error: { message: "private outage" },
              }),
          }),
        },
      }),
    } as never);

    await expect(storage.inventory(organizationId)).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });
});

describe("UnavailableEvidenceCleanupAdapter", () => {
  it("fails retention cleanup closed while its owning evidence capability is absent", async () => {
    await expect(
      new UnavailableEvidenceCleanupAdapter().remove(),
    ).rejects.toMatchObject({
      code: "dependency_unavailable",
      retryable: true,
    });
  });
});
