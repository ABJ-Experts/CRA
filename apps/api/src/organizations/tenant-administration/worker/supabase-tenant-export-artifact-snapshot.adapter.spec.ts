import { createHash } from "node:crypto";

import { WorkerFailure } from "./tenant-lifecycle-worker";
import { SupabaseTenantExportArtifactSnapshotAdapter } from "./supabase-tenant-export-artifact-snapshot.adapter";

const organizationId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";
const leaseOwner = "33333333-3333-4333-8333-333333333333";
const frozenObjectId = "44444444-4444-4444-8444-444444444444";
const frozenVersion = "artifact-version-1";
const frozenUpdatedAt = "2026-09-25T08:15:30.000Z";
const frozenUpdatedAtSqlOffset = "2026-09-25T08:15:30+00:00";

const blob = (value: string, type = "application/pdf"): Blob =>
  new Blob([Buffer.from(value, "utf8")], { type });

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

type StorageBucketMock = Readonly<{
  list: jest.Mock;
  download: jest.Mock;
  info: jest.Mock;
  upload: jest.Mock;
}>;

const makeStorageBucket = (): StorageBucketMock =>
  Object.freeze({
    list: jest.fn(),
    download: jest.fn(),
    info: jest.fn(() =>
      Promise.resolve({
        data: {
          id: frozenObjectId,
          version: frozenVersion,
          lastModified: frozenUpdatedAt,
        },
        error: null,
      }),
    ),
    upload: jest.fn(),
  });

const makeAdapter = (
  input: Readonly<{
    buckets?: readonly Readonly<{ id: string; public: boolean }>[];
    storage?: Readonly<Record<string, StorageBucketMock>>;
    listRows?: readonly unknown[];
    listError?: unknown;
    listData?: unknown;
    snapshotRow?: unknown;
    snapshotError?: unknown;
    rpcResult?: readonly Readonly<{ outcome: string }>[];
    rpcData?: unknown;
    rpcError?: unknown;
    maxBytes?: number;
  }> = {},
) => {
  const buckets =
    input.buckets ??
    Object.freeze([
      Object.freeze({ id: "tenant-exports", public: false }),
      Object.freeze({
        id: "evidence-documents",
        name: "evidence-documents",
        public: false,
      }),
      Object.freeze({ id: "public-assets", public: true }),
    ]);
  const storage: Readonly<Record<string, StorageBucketMock>> =
    input.storage ??
    Object.freeze({
      "tenant-exports": makeStorageBucket(),
      "evidence-documents": makeStorageBucket(),
      "public-assets": makeStorageBucket(),
    });
  const artifactRows = input.listRows ?? [];
  const snapshotRow = Object.hasOwn(input, "snapshotRow")
    ? input.snapshotRow
    : Object.freeze({
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath: `${organizationId}/evidence/report.pdf`,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      });
  const from = jest.fn((tableName: string) => {
    if (tableName === "organization_export_snapshots") {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn(() =>
                    Promise.resolve({
                      data: snapshotRow,
                      error: input.snapshotError ?? null,
                    }),
                  ),
                })),
              })),
            })),
          })),
        })),
      };
    }
    if (tableName === "organization_export_artifact_snapshots") {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() =>
                Object.freeze({
                  range: jest.fn((fromIndex: number, toIndex: number) =>
                    Promise.resolve({
                      data:
                        input.listData ??
                        artifactRows.slice(fromIndex, toIndex + 1),
                      error: input.listError ?? null,
                    }),
                  ),
                }),
              ),
            })),
          })),
        })),
      };
    }
    throw new Error(`unexpected table ${tableName}`);
  });
  const rpc = jest.fn(() =>
    Promise.resolve({
      data:
        input.rpcData ??
        input.rpcResult ??
        Object.freeze([Object.freeze({ outcome: "recorded" })]),
      error: input.rpcError ?? null,
    }),
  );
  const listBuckets = jest.fn(() =>
    Promise.resolve({ data: buckets, error: null }),
  );
  const storageFrom = jest.fn((bucketName: string) => {
    const bucket = storage[bucketName];
    if (!bucket) throw new Error(`unexpected bucket ${bucketName}`);
    return bucket;
  });
  const supabase = {
    admin: jest.fn(() => ({
      from,
      rpc,
      storage: { from: storageFrom, listBuckets },
    })),
  };
  const config = {
    getOrThrow: jest.fn(() => input.maxBytes ?? 1024 * 1024),
  };
  const adapter = new SupabaseTenantExportArtifactSnapshotAdapter(
    supabase as never,
    config as never,
  );
  return Object.freeze({
    adapter,
    storage,
    from,
    rpc,
    storageFrom,
    listBuckets,
    config,
  });
};

describe("SupabaseTenantExportArtifactSnapshotAdapter", () => {
  it("rejects an invalid configured artifact byte limit", () => {
    expect(() => makeAdapter({ maxBytes: 0 })).toThrow(
      "invalid tenant export artifact snapshot limit",
    );
  });

  it("uses frozen artifact inventory instead of live storage inventory", async () => {
    const sourcePath = `${organizationId}/frozen/report.pdf`;
    const artifactKey = `evidence-documents/${sha256(
      `evidence-documents/${sourcePath}`,
    )}`;
    const snapshotObjectPath = `${organizationId}/${exportId}/artifacts/${artifactKey}`;
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    tenantExports.upload.mockResolvedValueOnce({ data: null, error: null });
    tenantExports.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    const { adapter, listBuckets, rpc } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).resolves.toEqual(Object.freeze({ outcome: "snapshotted" }));

    expect(listBuckets).not.toHaveBeenCalled();
    expect(evidenceDocuments.list).not.toHaveBeenCalled();
    expect(evidenceDocuments.info).toHaveBeenCalledTimes(2);
    expect(evidenceDocuments.download).toHaveBeenCalledWith(sourcePath);
    expect(rpc).toHaveBeenCalledWith(
      "record_organization_export_artifact_snapshot_atomic",
      expect.objectContaining({
        p_artifact_key: artifactKey,
        p_snapshot_object_path: snapshotObjectPath,
        p_metadata: {
          bucket: "evidence-documents",
          sourcePath,
          objectId: frozenObjectId,
          version: frozenVersion,
          updatedAt: frozenUpdatedAt,
        },
      }),
    );
  });

  it("copies org-scoped private artifacts to tenant exports and records verified snapshots", async () => {
    const sourcePath = `${organizationId}/evidence/report.pdf`;
    const sourceBytes = Buffer.from("artifact bytes", "utf8");
    const sourceHash = sha256(sourceBytes);
    const artifactKey = `evidence-documents/${sha256(
      `evidence-documents/${sourcePath}`,
    )}`;
    const snapshotObjectPath = `${organizationId}/${exportId}/artifacts/${artifactKey}`;
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.download.mockResolvedValueOnce({
      data: blob("artifact bytes"),
      error: null,
    });
    tenantExports.upload.mockResolvedValueOnce({ data: null, error: null });
    tenantExports.download.mockResolvedValueOnce({
      data: blob("artifact bytes"),
      error: null,
    });
    const { adapter, from, rpc, storageFrom, listBuckets } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
        "public-assets": makeStorageBucket(),
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).resolves.toEqual(Object.freeze({ outcome: "snapshotted" }));

    expect(listBuckets).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("storage.buckets");
    expect(storageFrom).not.toHaveBeenCalledWith("public-assets");
    expect(evidenceDocuments.list).not.toHaveBeenCalled();
    expect(evidenceDocuments.download).toHaveBeenCalledWith(sourcePath);
    expect(tenantExports.upload).toHaveBeenCalledWith(
      snapshotObjectPath,
      sourceBytes,
      { contentType: "application/pdf", upsert: true },
    );
    expect(tenantExports.download).toHaveBeenCalledWith(snapshotObjectPath);
    expect(rpc).toHaveBeenCalledWith(
      "record_organization_export_artifact_snapshot_atomic",
      {
        p_organization_id: organizationId,
        p_export_job_id: exportId,
        p_lease_owner: leaseOwner,
        p_expected_checkpoint_version: 7,
        p_artifact_key: artifactKey,
        p_snapshot_object_path: snapshotObjectPath,
        p_sha256: sourceHash,
        p_byte_size: sourceBytes.length,
        p_content_type: "application/pdf",
        p_metadata: {
          bucket: "evidence-documents",
          sourcePath,
          objectId: frozenObjectId,
          version: frozenVersion,
          updatedAt: frozenUpdatedAt,
        },
      },
    );
  });

  it("accepts equivalent SQL and storage timestamp formats for unchanged sources", async () => {
    const sourcePath = `${organizationId}/offset/report.pdf`;
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    tenantExports.upload.mockResolvedValueOnce({ data: null, error: null });
    tenantExports.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAtSqlOffset,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).resolves.toEqual(Object.freeze({ outcome: "snapshotted" }));
  });

  it("returns replayed when every artifact snapshot was already recorded", async () => {
    const sourcePath = `${organizationId}/report.pdf`;
    const artifactKey = `evidence-documents/${sha256(
      `evidence-documents/${sourcePath}`,
    )}`;
    const snapshotObjectPath = `${organizationId}/${exportId}/artifacts/${artifactKey}`;
    const sourceHash = sha256("artifact bytes");
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.list.mockResolvedValueOnce({
      data: [{ id: "object-id", name: "report.pdf", metadata: {} }],
      error: null,
    });
    tenantExports.download.mockResolvedValueOnce({
      data: blob("artifact bytes", ""),
      error: null,
    });
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
      buckets: [
        { id: "tenant-exports", public: false },
        { id: "evidence-documents", public: false },
      ],
      listRows: [
        {
          artifact_key: artifactKey,
          snapshot_object_path: snapshotObjectPath,
          sha256: sourceHash,
          byte_size: Buffer.byteLength("artifact bytes"),
          content_type: "application/octet-stream",
          metadata: {
            bucket: "evidence-documents",
            sourcePath,
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        },
      ],
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath,
            contentType: "application/octet-stream",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).resolves.toEqual(Object.freeze({ outcome: "replayed" }));

    expect(tenantExports.download).toHaveBeenCalledWith(snapshotObjectPath);
    expect(evidenceDocuments.download).not.toHaveBeenCalled();
    expect(tenantExports.upload).not.toHaveBeenCalled();
  });

  it("rejects replay when existing ledger metadata disagrees with frozen identity", async () => {
    const sourcePath = `${organizationId}/report.pdf`;
    const artifactKey = `evidence-documents/${sha256(
      `evidence-documents/${sourcePath}`,
    )}`;
    const snapshotObjectPath = `${organizationId}/${exportId}/artifacts/${artifactKey}`;
    const tenantExports = makeStorageBucket();
    tenantExports.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": makeStorageBucket(),
      },
      listRows: [
        {
          artifact_key: artifactKey,
          snapshot_object_path: snapshotObjectPath,
          sha256: sha256("artifact bytes"),
          byte_size: Buffer.byteLength("artifact bytes"),
          content_type: "application/pdf",
          metadata: {
            bucket: "evidence-documents",
            sourcePath,
            objectId: "different-object",
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        },
      ],
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "artifact_inventory_mismatch",
      retryable: false,
    });
  });

  it.each([
    ["conflict", "conflict"],
    ["not_found", "not_found"],
    ["invalid_request", "unavailable"],
  ] as const)(
    "returns %s as %s without completing a copied artifact record",
    async (rpcOutcome, expectedOutcome) => {
      const tenantExports = makeStorageBucket();
      const evidenceDocuments = makeStorageBucket();
      evidenceDocuments.download.mockResolvedValueOnce({
        data: blob("artifact bytes", "application/pdf"),
        error: null,
      });
      tenantExports.upload.mockResolvedValueOnce({ data: null, error: null });
      tenantExports.download.mockResolvedValueOnce({
        data: blob("artifact bytes", "application/pdf"),
        error: null,
      });
      const { adapter } = makeAdapter({
        storage: {
          "tenant-exports": tenantExports,
          "evidence-documents": evidenceDocuments,
        },
        rpcResult: [{ outcome: rpcOutcome }],
      });

      await expect(
        adapter.snapshot({
          organizationId,
          exportId,
          leaseOwner,
          checkpointVersion: 7,
        }),
      ).resolves.toEqual(Object.freeze({ outcome: expectedOutcome }));
    },
  );

  it("returns not_found when the exact export snapshot is absent", async () => {
    const { adapter } = makeAdapter({ snapshotRow: null });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).resolves.toEqual(Object.freeze({ outcome: "not_found" }));
  });

  it("rejects invalid checkpoint versions before provider work", async () => {
    const { adapter, from } = makeAdapter();

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: -1,
      }),
    ).rejects.toMatchObject({ code: "invalid_checkpoint", retryable: false });

    expect(from).not.toHaveBeenCalled();
  });

  it("rejects malformed frozen inventory rows", async () => {
    const { adapter } = makeAdapter({
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "tenant-exports",
            sourcePath: `${organizationId}/artifact.pdf`,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider", retryable: false });
  });

  it("wraps unexpected provider exceptions as retryable provider failures", async () => {
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.info.mockImplementationOnce(() => {
      throw new Error("storage offline");
    });
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": makeStorageBucket(),
        "evidence-documents": evidenceDocuments,
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });

  it("enforces the configured byte limit before writing a copied artifact", async () => {
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.list.mockResolvedValueOnce({
      data: [{ id: "object-id", name: "large.pdf", metadata: {} }],
      error: null,
    });
    evidenceDocuments.download.mockResolvedValueOnce({
      data: blob("too large", ""),
      error: null,
    });
    const { adapter, rpc } = makeAdapter({
      maxBytes: 3,
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
      buckets: [
        { id: "tenant-exports", public: false },
        { id: "evidence-documents", public: false },
      ],
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({ code: "export_size_limit", retryable: false });

    expect(tenantExports.upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the copied artifact hash does not match the source", async () => {
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.list.mockResolvedValueOnce({
      data: [{ id: "object-id", name: "report.pdf", metadata: {} }],
      error: null,
    });
    evidenceDocuments.download.mockResolvedValueOnce({
      data: blob("source", ""),
      error: null,
    });
    tenantExports.upload.mockResolvedValueOnce({ data: null, error: null });
    tenantExports.download.mockResolvedValueOnce({
      data: blob("different", ""),
      error: null,
    });
    const { adapter, rpc } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
      buckets: [
        { id: "tenant-exports", public: false },
        { id: "evidence-documents", public: false },
      ],
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "artifact_snapshot_integrity_failed",
      retryable: true,
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the source object changed before download", async () => {
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.info.mockResolvedValueOnce({
      data: {
        id: "different-object",
        version: frozenVersion,
        lastModified: frozenUpdatedAt,
      },
      error: null,
    });
    const { adapter, rpc } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "artifact_source_changed",
      retryable: false,
    });

    expect(evidenceDocuments.download).not.toHaveBeenCalled();
    expect(tenantExports.upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the source object changed during download", async () => {
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    evidenceDocuments.info
      .mockResolvedValueOnce({
        data: {
          id: frozenObjectId,
          version: frozenVersion,
          lastModified: frozenUpdatedAt,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: frozenObjectId,
          version: "artifact-version-2",
          lastModified: frozenUpdatedAt,
        },
        error: null,
      });
    const { adapter, rpc } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "artifact_source_changed",
      retryable: false,
    });

    expect(evidenceDocuments.download).toHaveBeenCalledTimes(1);
    expect(tenantExports.upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when a source artifact download is missing bytes", async () => {
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.download.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": makeStorageBucket(),
        "evidence-documents": evidenceDocuments,
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider", retryable: false });
  });

  it("treats upload failures as retryable provider failures", async () => {
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    tenantExports.upload.mockResolvedValueOnce({
      data: null,
      error: new Error("upload failed"),
    });
    const { adapter, rpc } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when an existing replayed snapshot path crosses tenants", async () => {
    const sourcePath = `${organizationId}/report.pdf`;
    const artifactKey = `evidence-documents/${sha256(
      `evidence-documents/${sourcePath}`,
    )}`;
    const { adapter } = makeAdapter({
      listRows: [
        {
          artifact_key: artifactKey,
          snapshot_object_path: `other-org/${exportId}/artifacts/${artifactKey}`,
          sha256: sha256("artifact bytes"),
          byte_size: Buffer.byteLength("artifact bytes"),
          content_type: "application/pdf",
          metadata: {
            bucket: "evidence-documents",
            sourcePath,
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        },
      ],
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider", retryable: false });
  });

  it("fails closed when an existing replayed snapshot hash changed", async () => {
    const sourcePath = `${organizationId}/report.pdf`;
    const artifactKey = `evidence-documents/${sha256(
      `evidence-documents/${sourcePath}`,
    )}`;
    const snapshotObjectPath = `${organizationId}/${exportId}/artifacts/${artifactKey}`;
    const tenantExports = makeStorageBucket();
    tenantExports.download.mockResolvedValueOnce({
      data: blob("changed bytes", "application/pdf"),
      error: null,
    });
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": makeStorageBucket(),
      },
      listRows: [
        {
          artifact_key: artifactKey,
          snapshot_object_path: snapshotObjectPath,
          sha256: sha256("artifact bytes"),
          byte_size: Buffer.byteLength("artifact bytes"),
          content_type: "application/pdf",
          metadata: {
            bucket: "evidence-documents",
            sourcePath,
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        },
      ],
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "artifact_snapshot_integrity_failed",
      retryable: true,
    });
  });

  it("fails closed on malformed RPC outcomes", async () => {
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    evidenceDocuments.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    tenantExports.upload.mockResolvedValueOnce({ data: null, error: null });
    tenantExports.download.mockResolvedValueOnce({
      data: blob("artifact bytes", "application/pdf"),
      error: null,
    });
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
      rpcData: [{ outcome: "surprise" }],
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider", retryable: false });
  });

  it("rejects unsafe source names before composing destination keys", async () => {
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
      buckets: [
        { id: "tenant-exports", public: false },
        { id: "evidence-documents", public: false },
      ],
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath: `${organizationId}/../escape.pdf`,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toBeInstanceOf(WorkerFailure);

    expect(evidenceDocuments.download).not.toHaveBeenCalled();
    expect(tenantExports.upload).not.toHaveBeenCalled();
  });

  it("rejects recorded artifact rows that are not in the frozen inventory", async () => {
    const inventoryPath = `${organizationId}/expected.pdf`;
    const extraPath = `${organizationId}/extra.pdf`;
    const extraKey = `evidence-documents/${sha256(
      `evidence-documents/${extraPath}`,
    )}`;
    const tenantExports = makeStorageBucket();
    const evidenceDocuments = makeStorageBucket();
    const { adapter } = makeAdapter({
      storage: {
        "tenant-exports": tenantExports,
        "evidence-documents": evidenceDocuments,
      },
      listRows: [
        {
          artifact_key: extraKey,
          snapshot_object_path: `${organizationId}/${exportId}/artifacts/${extraKey}`,
          sha256: sha256("extra bytes"),
          byte_size: Buffer.byteLength("extra bytes"),
          content_type: "application/pdf",
          metadata: { bucket: "evidence-documents", sourcePath: extraPath },
        },
      ],
      snapshotRow: {
        artifact_inventory: [
          {
            bucketId: "evidence-documents",
            sourcePath: inventoryPath,
            contentType: "application/pdf",
            objectId: frozenObjectId,
            version: frozenVersion,
            updatedAt: frozenUpdatedAt,
            byteSize: null,
          },
        ],
      },
    });

    await expect(
      adapter.snapshot({
        organizationId,
        exportId,
        leaseOwner,
        checkpointVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "artifact_inventory_mismatch",
      retryable: false,
    });

    expect(evidenceDocuments.download).not.toHaveBeenCalled();
    expect(tenantExports.upload).not.toHaveBeenCalled();
  });

  it("lists recorded artifact snapshots using the org and export boundary", async () => {
    const row = Object.freeze({
      artifact_key: "evidence-documents/hash",
      snapshot_object_path: `${organizationId}/${exportId}/artifacts/evidence-documents/hash`,
      sha256: sha256("artifact bytes"),
      byte_size: 14,
      content_type: "application/pdf",
      metadata: {
        bucket: "evidence-documents",
        sourcePath: `${organizationId}/a.pdf`,
      },
    });
    const { adapter, from } = makeAdapter({ listRows: [row] });

    await expect(adapter.list(organizationId, exportId)).resolves.toEqual([
      {
        artifactKey: row.artifact_key,
        snapshotObjectPath: row.snapshot_object_path,
        sha256: row.sha256,
        byteSize: row.byte_size,
        contentType: row.content_type,
        metadata: row.metadata,
      },
    ]);

    expect(from).toHaveBeenCalledWith("organization_export_artifact_snapshots");
  });

  it("fails closed when artifact snapshot list rows are malformed", async () => {
    const { adapter } = makeAdapter({
      listRows: [{ artifact_key: "missing-required-fields" }],
    });

    await expect(adapter.list(organizationId, exportId)).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });

  it("treats artifact snapshot list provider errors as retryable", async () => {
    const { adapter } = makeAdapter({
      listError: new Error("query failed"),
    });

    await expect(adapter.list(organizationId, exportId)).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });

  it("paginates recorded artifact snapshots for large exports", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) =>
      Object.freeze({
        artifact_key: `evidence-documents/${String(index).padStart(64, "0")}`,
        snapshot_object_path: `${organizationId}/${exportId}/artifacts/evidence-documents/${String(index).padStart(64, "0")}`,
        sha256: sha256(`artifact-${index}`),
        byte_size: 10,
        content_type: "application/octet-stream",
        metadata: {
          bucket: "evidence-documents",
          sourcePath: `${organizationId}/${index}`,
        },
      }),
    );
    const { adapter } = makeAdapter({ listRows: rows });

    await expect(adapter.list(organizationId, exportId)).resolves.toHaveLength(
      1001,
    );
  });
});
