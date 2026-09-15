import { createHash } from "node:crypto";

import {
  TenantLifecycleWorker,
  type TenantLifecycleWorkerDependencies,
} from "./tenant-lifecycle-worker";

const organizationId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";
const leaseOwner = "33333333-3333-4333-8333-333333333333";

describe("TenantLifecycleWorker", () => {
  it("materializes the immutable record snapshot before reading sources", async () => {
    const materialize = jest
      .fn()
      .mockResolvedValue({ outcome: "materialized", checkpointVersion: 0 });
    const read = jest.fn().mockResolvedValue(Buffer.from('{"id":"org"}\n'));
    const worker = new TenantLifecycleWorker(
      dependencies({
        sources: { read },
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
            sourceIds: ["organization_profile"],
          }),
          materialize,
          parts: jest.fn().mockResolvedValue([]),
          context: jest.fn().mockResolvedValue({
            actorId: leaseOwner,
            requestedAt: "2026-08-10T00:00:00.000Z",
          }),
          checkpoint: jest.fn().mockResolvedValue({
            outcome: "checkpointed",
            checkpointVersion: 1,
          }),
          complete: jest.fn().mockResolvedValue({ outcome: "completed" }),
          fail: jest.fn(),
        },
      }),
    );

    await worker.runOnce();

    expect(materialize).toHaveBeenCalledWith({
      organizationId,
      exportId,
      leaseOwner,
      checkpointVersion: 0,
    });
    expect(read).toHaveBeenCalledWith(
      organizationId,
      exportId,
      "organization_profile",
    );
  });

  it("checkpoints exact source bytes, then completes a hashed version-1 ZIP", async () => {
    const objects = new Map<string, Buffer>();
    const checkpoints: unknown[] = [];
    const complete = jest.fn().mockResolvedValue({ outcome: "completed" });
    const worker = new TenantLifecycleWorker(
      dependencies({
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
            sourceIds: ["organization_profile", "memberships"],
          }),
          parts: jest.fn().mockResolvedValue([]),
          context: jest.fn().mockResolvedValue({
            actorId: "44444444-4444-4444-8444-444444444444",
            requestedAt: "2026-08-10T00:00:00.000Z",
          }),
          checkpoint: jest.fn((command) => {
            checkpoints.push(command);
            return Promise.resolve({
              outcome: "checkpointed" as const,
              checkpointVersion: checkpoints.length,
            });
          }),
          complete,
          fail: jest.fn(),
        },
        storage: memoryStorage(objects),
      }),
    );

    await worker.runOnce();

    expect(checkpoints).toHaveLength(2);
    expect(
      objects.get(
        `${organizationId}/${exportId}/parts/organization_profile.ndjson`,
      ),
    ).toEqual(Buffer.from('{"id":"org"}\n'));
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        exportId,
        checkpointVersion: 2,
        manifestFileCount: 2,
        artifactObjectPath: `${organizationId}/${exportId}/organization-export-v1.zip`,
      }),
    );
  });

  it("fails before database completion when the uploaded ZIP read-back hash is corrupt", async () => {
    const objects = new Map<string, Buffer>();
    const complete = jest.fn();
    const fail = jest.fn();
    const storage = {
      read: jest.fn((path: string) =>
        Promise.resolve(objects.get(path) ?? null),
      ),
      write: jest.fn((path: string, bytes: Buffer) => {
        objects.set(
          path,
          path.endsWith("/organization-export-v1.zip")
            ? Buffer.from("corrupt archive")
            : Buffer.from(bytes),
        );
        return Promise.resolve();
      }),
    };
    const worker = new TenantLifecycleWorker(
      dependencies({
        storage,
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
            sourceIds: ["organization_profile"],
          }),
          parts: jest.fn().mockResolvedValue([]),
          context: jest.fn().mockResolvedValue({
            actorId: "44444444-4444-4444-8444-444444444444",
            requestedAt: "2026-08-10T00:00:00.000Z",
          }),
          checkpoint: jest.fn().mockResolvedValue({
            outcome: "checkpointed",
            checkpointVersion: 1,
          }),
          complete,
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "artifact_corrupt", retryable: true }),
    );
  });

  it("reuploads a corrupt persisted part, checkpoints it at the same ledger size, and resumes", async () => {
    const path = `${organizationId}/${exportId}/parts/organization_profile.ndjson`;
    const expected = Buffer.from('{"id":"org"}\n');
    const checkpoint = jest.fn().mockResolvedValue({
      outcome: "checkpointed",
      checkpointVersion: 8,
    });
    const objects = new Map<string, Buffer>([[path, Buffer.from("corrupt")]]);
    const worker = new TenantLifecycleWorker(
      dependencies({
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 7,
            sourceIds: ["organization_profile"],
          }),
          parts: jest
            .fn()
            .mockResolvedValueOnce([
              {
                sourceId: "organization_profile",
                partNumber: 1,
                objectPath: path,
                sha256: createHash("sha256").update(expected).digest("hex"),
                byteSize: expected.length,
              },
            ])
            .mockResolvedValueOnce([
              {
                sourceId: "organization_profile",
                partNumber: 1,
                objectPath: path,
                sha256: createHash("sha256").update(expected).digest("hex"),
                byteSize: expected.length,
              },
            ]),
          context: jest.fn().mockResolvedValue({
            actorId: "44444444-4444-4444-8444-444444444444",
            requestedAt: "2026-08-10T00:00:00.000Z",
          }),
          checkpoint,
          complete: jest.fn().mockResolvedValue({ outcome: "completed" }),
          fail: jest.fn(),
        },
        storage: memoryStorage(objects),
      }),
    );

    await worker.runOnce();

    expect(objects.get(path)).toEqual(expected);
    expect(checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({ completedParts: 1, totalParts: 1 }),
    );
  });

  it("does not retry after a lease conflict and records only safe failure diagnostics", async () => {
    const fail = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
            sourceIds: ["organization_profile"],
          }),
          parts: jest.fn().mockResolvedValue([]),
          context: jest.fn().mockResolvedValue({
            actorId: "44444444-4444-4444-8444-444444444444",
            requestedAt: "2026-08-10T00:00:00.000Z",
          }),
          checkpoint: jest.fn().mockResolvedValue({ outcome: "conflict" }),
          complete: jest.fn(),
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(fail).not.toHaveBeenCalled();
  });

  it("passes every cleanup item result exactly once and fail-closes an unavailable authority", async () => {
    const complete = jest.fn().mockResolvedValue({ outcome: "completed" });
    const worker = new TenantLifecycleWorker(
      dependencies({
        cleanup: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest
            .fn()
            .mockResolvedValueOnce({ outcome: "unavailable" })
            .mockResolvedValueOnce({
              outcome: "claimed",
              runId: "55555555-5555-4555-8555-555555555555",
              leaseOwner,
              checkpointVersion: 3,
              evidenceClass: "sbom",
              items: [
                {
                  itemId: "66666666-6666-4666-8666-666666666666",
                  sourceRecordId: "77777777-7777-4777-8777-777777777777",
                },
              ],
            }),
          complete,
          fail: jest.fn(),
        },
      }),
    );
    await worker.runOnce();
    await worker.runOnce();

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [
          expect.objectContaining({
            itemId: "66666666-6666-4666-8666-666666666666",
            status: "deleted",
          }),
        ],
      }),
    );
  });

  it("retries post-delete artifact work without restoring a purged tenant", async () => {
    const fail = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        artifactWork: {
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            workId: "88888888-8888-4888-8888-888888888888",
            objectPrefix: `${organizationId}/`,
          }),
          complete: jest.fn(),
          fail,
        },
        artifacts: {
          inventory: jest.fn(),
          deletePrefix: jest
            .fn()
            .mockRejectedValue(new Error("private outage")),
        },
      }),
    );

    await worker.runOnce();

    expect(fail).toHaveBeenCalledWith({
      workId: "88888888-8888-4888-8888-888888888888",
      leaseOwner,
      code: "provider_unavailable",
      retryable: true,
    });
  });

  it("fails a ZIP that exceeds the configured in-memory archive limit before completion", async () => {
    const fail = jest.fn();
    const complete = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        maximumArchiveBytes: 8,
        sources: {
          read: jest
            .fn()
            .mockResolvedValue(Buffer.from('{"id":"organization"}\n')),
        },
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
            sourceIds: ["organization_profile"],
          }),
          parts: jest.fn().mockResolvedValue([]),
          context: jest.fn().mockResolvedValue({
            actorId: "44444444-4444-4444-8444-444444444444",
            requestedAt: "2026-08-10T00:00:00.000Z",
          }),
          checkpoint: jest.fn().mockResolvedValue({
            outcome: "checkpointed",
            checkpointVersion: 1,
          }),
          complete,
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "export_size_limit", retryable: false }),
    );
  });

  it("rejects an invalid lease or archive ceiling during worker composition", () => {
    expect(
      () => new TenantLifecycleWorker(dependencies({ leaseSeconds: 0 })),
    ).toThrow("invalid tenant lifecycle worker lease");
    expect(
      () => new TenantLifecycleWorker(dependencies({ maximumArchiveBytes: 0 })),
    ).toThrow("invalid tenant lifecycle worker archive limit");
  });

  it("fails an invalid export snapshot safely without writing a partial archive", async () => {
    const fail = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
            sourceIds: ["unregistered_source"],
          }),
          parts: jest.fn(),
          context: jest.fn(),
          checkpoint: jest.fn(),
          complete: jest.fn(),
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "invalid_export_source",
        retryable: false,
      }),
    );
  });

  it("does not fail a job after an org-scoped context disappears under its lease", async () => {
    const fail = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
            sourceIds: ["organization_profile"],
          }),
          parts: jest.fn().mockResolvedValue([]),
          context: jest.fn().mockResolvedValue(null),
          checkpoint: jest.fn(),
          complete: jest.fn(),
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(fail).not.toHaveBeenCalled();
  });

  it("records retryable cleanup and purge provider interruptions with their durable leases", async () => {
    const cleanupFail = jest.fn();
    const purgeFail = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        cleanup: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            runId: jobId(),
            leaseOwner,
            checkpointVersion: 0,
            evidenceClass: "audit_event",
            items: [{ itemId: jobId(), sourceRecordId: jobId() }],
          }),
          complete: jest.fn(),
          fail: cleanupFail,
        },
        evidenceCleanup: {
          remove: jest
            .fn()
            .mockRejectedValue(new Error("private cleanup outage")),
        },
        purge: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
          }),
          complete: jest.fn(),
          fail: purgeFail,
        },
        artifacts: {
          inventory: jest
            .fn()
            .mockRejectedValue(new Error("private storage outage")),
          deletePrefix: jest.fn(),
        },
      }),
    );

    await worker.runOnce();

    expect(cleanupFail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "provider_unavailable",
        retryable: true,
      }),
    );
    expect(purgeFail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "provider_unavailable",
        retryable: true,
      }),
    );
  });

  it("fails closed when post-delete work has no artifact deletion capability", async () => {
    const fail = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        artifactWork: {
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            workId: exportId,
            objectPrefix: `${organizationId}/`,
          }),
          complete: jest.fn(),
          fail,
        },
        artifacts: { inventory: jest.fn() },
      }),
    );

    await worker.runOnce();

    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "dependency_unavailable",
        retryable: true,
      }),
    );
  });

  it("fails a corrupt resumed export artifact and never completes it", async () => {
    const expected = Buffer.from('{"id":"org"}\n');
    const partPath = `${organizationId}/${exportId}/parts/organization_profile.ndjson`;
    const fail = jest.fn();
    const storage = {
      read: jest
        .fn()
        .mockResolvedValueOnce(expected)
        .mockResolvedValueOnce(Buffer.from("corrupt")),
      write: jest.fn(),
    };
    const worker = new TenantLifecycleWorker(
      dependencies({
        storage,
        export: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
            sourceIds: ["organization_profile"],
          }),
          parts: jest.fn().mockResolvedValue([
            {
              sourceId: "organization_profile",
              partNumber: 1,
              objectPath: partPath,
              sha256: createHash("sha256").update(expected).digest("hex"),
              byteSize: expected.length,
            },
          ]),
          context: jest.fn().mockResolvedValue({
            actorId: leaseOwner,
            requestedAt: "2026-08-10T00:00:00.000Z",
          }),
          checkpoint: jest.fn(),
          complete: jest.fn(),
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "artifact_corrupt",
        retryable: true,
      }),
    );
  });

  it("records a nonretryable cleanup rejection without losing its durable lease", async () => {
    const cleanupFail = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        cleanup: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            runId: jobId(),
            leaseOwner,
            checkpointVersion: 0,
            evidenceClass: "audit_event",
            items: [{ itemId: jobId(), sourceRecordId: jobId() }],
          }),
          complete: jest.fn().mockResolvedValue({ outcome: "invalid_request" }),
          fail: cleanupFail,
        },
      }),
    );

    await worker.runOnce();

    expect(cleanupFail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "cleanup_rejected",
        retryable: false,
      }),
    );
  });

  it("dead-letters impossible purge and artifact completion outcomes without restoring access", async () => {
    const purgeFail = jest.fn();
    const artifactFail = jest.fn();
    const worker = new TenantLifecycleWorker(
      dependencies({
        purge: {
          dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            jobId: exportId,
            leaseOwner,
            checkpointVersion: 0,
          }),
          complete: jest.fn().mockResolvedValue({ outcome: "unexpected" }),
          fail: purgeFail,
        },
        artifactWork: {
          claim: jest.fn().mockResolvedValue({
            outcome: "claimed",
            workId: exportId,
            objectPrefix: `${organizationId}/`,
          }),
          complete: jest.fn().mockResolvedValue({ outcome: "unexpected" }),
          fail: artifactFail,
        },
      }),
    );

    await worker.runOnce();

    expect(purgeFail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "purge_rejected",
        retryable: false,
      }),
    );
    expect(artifactFail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "artifact_work_rejected",
        retryable: false,
      }),
    );
  });
});

let testIdSequence = 100;
function jobId(): string {
  testIdSequence += 1;
  return `00000000-0000-4000-8000-${testIdSequence.toString().padStart(12, "0")}`;
}

type WorkerTestOverrides = Omit<
  Partial<TenantLifecycleWorkerDependencies>,
  "artifactSnapshot" | "export" | "sources"
> & {
  artifactSnapshot?: Partial<
    TenantLifecycleWorkerDependencies["artifactSnapshot"]
  >;
  export?: Partial<TenantLifecycleWorkerDependencies["export"]>;
  sources?: Partial<TenantLifecycleWorkerDependencies["sources"]>;
};

function dependencies(
  overrides: WorkerTestOverrides = {},
): TenantLifecycleWorkerDependencies {
  const exportDependencies: TenantLifecycleWorkerDependencies["export"] = {
    dueOrganizationIds: jest.fn().mockResolvedValue([]),
    claim: jest.fn().mockResolvedValue({ outcome: "none_available" }),
    materialize: jest
      .fn()
      .mockResolvedValue({ outcome: "replayed", checkpointVersion: 0 }),
    parts: jest.fn().mockResolvedValue([]),
    context: jest.fn(),
    checkpoint: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  };
  const sourceDependencies: TenantLifecycleWorkerDependencies["sources"] = {
    read: jest.fn((_organizationId, exportIdOrSourceId, sourceId) =>
      Promise.resolve(
        Buffer.from(
          (sourceId ?? exportIdOrSourceId) === "organization_profile"
            ? '{"id":"org"}\n'
            : '{"organizationId":"org","member":"member"}\n',
        ),
      ),
    ),
  };
  const artifactSnapshot: TenantLifecycleWorkerDependencies["artifactSnapshot"] =
    {
      snapshot: jest.fn().mockResolvedValue({ outcome: "snapshotted" }),
    };
  const {
    artifactSnapshot: artifactSnapshotOverride,
    export: exportOverride,
    sources: sourceOverride,
    ...otherOverrides
  } = overrides;
  return {
    workerId: leaseOwner,
    leaseSeconds: 60,
    maximumArchiveBytes: 47_000_000,
    sources: { ...sourceDependencies, ...sourceOverride },
    storage: memoryStorage(new Map()),
    export: { ...exportDependencies, ...exportOverride },
    cleanup: {
      dueOrganizationIds: jest.fn().mockResolvedValue([]),
      claim: jest.fn().mockResolvedValue({ outcome: "none_available" }),
      complete: jest.fn(),
      fail: jest.fn(),
    },
    purge: {
      dueOrganizationIds: jest.fn().mockResolvedValue([]),
      claim: jest.fn().mockResolvedValue({ outcome: "none_available" }),
      complete: jest.fn(),
      fail: jest.fn(),
    },
    artifactWork: {
      claim: jest.fn().mockResolvedValue({ outcome: "none_available" }),
      complete: jest.fn(),
      fail: jest.fn(),
    },
    evidenceCleanup: {
      remove: jest.fn().mockResolvedValue({ status: "deleted" }),
    },
    artifacts: {
      inventory: jest.fn().mockResolvedValue([]),
      deletePrefix: jest.fn(),
    },
    artifactSnapshot: { ...artifactSnapshot, ...artifactSnapshotOverride },
    ...otherOverrides,
  } satisfies TenantLifecycleWorkerDependencies;
}

function memoryStorage(objects: Map<string, Buffer>) {
  return {
    read: jest.fn((path: string) => Promise.resolve(objects.get(path) ?? null)),
    write: jest.fn((path: string, bytes: Buffer) => {
      objects.set(path, Buffer.from(bytes));
      return Promise.resolve();
    }),
  };
}
