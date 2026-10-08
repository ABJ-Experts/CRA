import { Readable } from "node:stream";

import {
  AuditExplorerForbiddenError,
  AuditExplorerNotFoundError,
  AuditExplorerUnavailableError,
} from "./audit-explorer.errors";
import { SupabaseAuditExplorerRepository } from "./supabase-audit-explorer.repository";

const orgId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const sha256 = "a".repeat(64);
const objectPath = `${orgId}/${jobId}/${sha256}.zip`;

describe("SupabaseAuditExplorerRepository", () => {
  beforeEach(() => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-10-07T12:00:00.000Z"));
  });
  afterEach(() => jest.restoreAllMocks());

  it("resolves permissions with orgId as the first scoped boundary", async () => {
    const fromCalls: Array<{
      table: string;
      filters: Array<[string, string]>;
    }> = [];
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase({ fromCalls }) as never,
      fakeStorage() as never,
    );

    await repository.effectivePermissions(orgId, actorId, "owner");

    expect(fromCalls).toEqual([
      {
        table: "user_role_assignments",
        filters: [
          ["organization_id", orgId],
          ["user_id", actorId],
        ],
      },
      {
        table: "base_role_permission_overrides",
        filters: [
          ["organization_id", orgId],
          ["base_role", "owner"],
        ],
      },
      {
        table: "organization_permissions_version",
        filters: [["organization_id", orgId]],
      },
    ]);
  });

  it("parses export status into the public schema and drops private job fields", async () => {
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase({
        rpcData: {
          id: jobId,
          state: "ready",
          format: "csv",
          created_at: "2026-10-07T00:00:00.000Z",
          expires_at: "2026-10-08T00:00:00.000Z",
          row_count: 12,
          selected_event_ids: ["55555555-5555-4555-8555-555555555555"],
          artifact: { sha256, objectPath, bytes: 100 },
          download_grant_digest: "b".repeat(64),
          download_session_id: "66666666-6666-4666-8666-666666666666",
          failure_code: null,
        },
      }) as never,
      fakeStorage() as never,
    );

    await expect(
      repository.getExport({
        organizationId: orgId,
        actorId,
        requestId,
        jobId,
      }),
    ).resolves.toEqual({
      id: jobId,
      status: "ready",
      format: "csv",
      createdAt: "2026-10-07T00:00:00.000Z",
      expiresAt: "2026-10-08T00:00:00.000Z",
      rowCount: 12,
      packageHash: sha256,
      failureCode: null,
    });
  });

  it("retains non-ready provider states even when their expiry is past", async () => {
    for (const state of ["queued", "processing", "failed"] as const) {
      const repository = new SupabaseAuditExplorerRepository(
        fakeSupabase({
          rpcData: {
            id: jobId,
            state,
            format: "csv",
            created_at: "2026-10-07T00:00:00.000Z",
            expires_at: "2020-01-01T00:00:00.000Z",
            row_count: null,
            artifact: null,
            failure_code: state === "failed" ? "generation_failed" : null,
          },
        }) as never,
        fakeStorage() as never,
      );

      await expect(
        repository.getExport({
          organizationId: orgId,
          actorId,
          requestId,
          jobId,
        }),
      ).resolves.toMatchObject({ status: state });
    }
  });

  it("projects ready jobs with past expiry as expired without mutating provider state", async () => {
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase({
        rpcData: {
          id: jobId,
          state: "ready",
          format: "csv",
          created_at: "2026-10-07T00:00:00.000Z",
          expires_at: "2020-01-01T00:00:00.000Z",
          row_count: 12,
          artifact: { sha256, objectPath, bytes: 100 },
          failure_code: null,
        },
      }) as never,
      fakeStorage() as never,
    );

    await expect(
      repository.getExport({
        organizationId: orgId,
        actorId,
        requestId,
        jobId,
      }),
    ).resolves.toMatchObject({
      id: jobId,
      status: "expired",
      rowCount: 12,
      packageHash: sha256,
    });
  });

  it("fails closed on malformed provider job data", async () => {
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase({ rpcData: { id: jobId, state: "ready" } }) as never,
      fakeStorage() as never,
    );

    await expect(
      repository.getExport({
        organizationId: orgId,
        actorId,
        requestId,
        jobId,
      }),
    ).rejects.toThrow();
  });

  it("maps denied RPC reads to not found", async () => {
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase({ rpcError: { code: "42501", message: "denied" } }) as never,
      fakeStorage() as never,
    );

    await expect(
      repository.getExport({
        organizationId: orgId,
        actorId,
        requestId,
        jobId,
      }),
    ).rejects.toBeInstanceOf(AuditExplorerNotFoundError);
  });

  it("opens verified storage with expected object path, hash, and byte size", async () => {
    const cleanup = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const storage = fakeStorage({ cleanup });
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase() as never,
      storage as never,
    );

    await expect(
      repository.downloadPackage({
        organizationId: orgId,
        jobId,
        packageHash: sha256,
        objectPath,
        bytes: 9,
      }),
    ).resolves.toMatchObject({
      contentLength: 9,
      packageHash: sha256,
      cleanup,
    });
    expect(storage.openVerified).toHaveBeenCalledWith({
      objectPath,
      sha256,
      byteSize: 9,
    });
  });

  it("does not open storage for a forged object path", async () => {
    const storage = fakeStorage();
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase() as never,
      storage as never,
    );

    await expect(
      repository.downloadPackage({
        organizationId: orgId,
        jobId,
        packageHash: sha256,
        objectPath: `${orgId}/${jobId}/${"b".repeat(64)}.zip`,
        bytes: 9,
      }),
    ).rejects.toBeInstanceOf(AuditExplorerForbiddenError);
    expect(storage.openVerified).not.toHaveBeenCalled();
  });

  it("fails closed when verified storage rejects corrupt bytes", async () => {
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase() as never,
      fakeStorage({ opened: null }) as never,
    );

    await expect(
      repository.downloadPackage({
        organizationId: orgId,
        jobId,
        packageHash: sha256,
        objectPath,
        bytes: 9,
      }),
    ).rejects.toBeInstanceOf(AuditExplorerUnavailableError);
  });
});

function fakeSupabase(
  options: {
    rpcData?: unknown;
    rpcError?: { code?: string; message?: string };
    fromCalls?: Array<{ table: string; filters: Array<[string, string]> }>;
    fromData?: Record<string, unknown>;
    fromErrorTable?: string;
  } = {},
) {
  return {
    admin: () => ({
      rpc: () =>
        Promise.resolve({
          data: options.rpcData,
          error: options.rpcError ?? null,
        }),
      from: (table: string) => {
        const call = { table, filters: [] as Array<[string, string]> };
        options.fromCalls?.push(call);
        const query = {
          select: () => query,
          eq: (column: string, value: string) => {
            call.filters.push([column, value]);
            return query;
          },
          maybeSingle: () =>
            Promise.resolve({
              data:
                table in (options.fromData ?? {})
                  ? options.fromData?.[table]
                  : table === "organization_permissions_version"
                    ? { version: 7 }
                    : { permissions: {} },
              error:
                options.fromErrorTable === table
                  ? { message: "provider down" }
                  : null,
            }),
          then: (
            resolve: (value: {
              data: unknown;
              error: { message: string } | null;
            }) => void,
          ) =>
            resolve({
              data:
                table in (options.fromData ?? {})
                  ? options.fromData?.[table]
                  : [],
              error:
                options.fromErrorTable === table
                  ? { message: "provider down" }
                  : null,
            }),
        };
        return query;
      },
    }),
  };
}

function fakeStorage(
  options: {
    opened?: {
      stream: () => NodeJS.ReadableStream;
      byteSize: number;
      sha256: string;
      cleanup: () => Promise<void>;
    } | null;
    cleanup?: () => Promise<void>;
  } = {},
) {
  const opened =
    "opened" in options
      ? options.opened
      : {
          stream: () => Readable.from(Buffer.from("zip-bytes")),
          byteSize: 9,
          sha256,
          cleanup: options.cleanup ?? (() => Promise.resolve(undefined)),
        };
  return { openVerified: jest.fn().mockResolvedValue(opened) };
}

describe("SupabaseAuditExplorerRepository read RPC adapters", () => {
  const event = {
    id: "55555555-5555-4555-8555-555555555555",
    sequence: "7",
    legacy: false,
    createdAt: "2026-10-07T00:00:00.000Z",
    actor: { id: actorId, type: "user", label: null },
    action: "organization.updated",
    resourceType: "organization",
    resourceId: orgId,
    correlationId: null,
    outcome: "completed",
    verificationStatus: "event_hashes_checked",
  } as const;
  const filters = {
    from: "2026-10-07T00:00:00.000Z",
    to: "2026-10-07T01:00:00.000Z",
  } as const;

  it("parses page rows and carries the keyset cursor", async () => {
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase({
        rpcData: [
          {
            event,
            afterSequence: "7",
            afterCreatedAt: null,
            afterId: event.id,
          },
        ],
      }) as never,
      fakeStorage() as never,
    );

    await expect(
      repository.readPage({
        organizationId: orgId,
        actorId,
        receiptId: "66666666-6666-4666-8666-666666666666",
        filterDigest: "a".repeat(64),
        scopeDigest: "b".repeat(64),
        filters,
        allowedEntityTypes: ["organization"],
        cursor: { afterSequence: null, afterCreatedAt: null, afterId: null },
        limit: 50,
      }),
    ).resolves.toEqual({
      items: [event],
      lastCursor: {
        afterSequence: "7",
        afterCreatedAt: null,
        afterId: event.id,
      },
    });
  });

  it("parses detail and verification responses", async () => {
    const detailRepository = new SupabaseAuditExplorerRepository(
      fakeSupabase({
        rpcData: { event, before: null, after: { ok: true }, reason: null },
      }) as never,
      fakeStorage() as never,
    );
    await expect(
      detailRepository.readDetail({
        organizationId: orgId,
        actorId,
        receiptId: "66666666-6666-4666-8666-666666666666",
        filterDigest: "a".repeat(64),
        scopeDigest: "b".repeat(64),
        filters,
        allowedEntityTypes: ["organization"],
        eventId: event.id,
      }),
    ).resolves.toEqual({
      event,
      before: null,
      after: { ok: true },
      reason: null,
    });

    const verifyRepository = new SupabaseAuditExplorerRepository(
      fakeSupabase({
        rpcData: {
          checkedAt: "2026-10-07T00:00:00.000Z",
          items: [{ eventId: event.id, status: "event_hashes_checked" }],
          completenessProven: false,
          authenticityProven: false,
        },
      }) as never,
      fakeStorage() as never,
    );
    await expect(
      verifyRepository.verify({
        organizationId: orgId,
        actorId,
        receiptId: "66666666-6666-4666-8666-666666666666",
        filterDigest: "a".repeat(64),
        scopeDigest: "b".repeat(64),
        filters,
        allowedEntityTypes: ["organization"],
        eventIds: [event.id],
      }),
    ).resolves.toEqual({
      checkedAt: "2026-10-07T00:00:00.000Z",
      items: [{ eventId: event.id, status: "event_hashes_checked" }],
      completenessProven: false,
      authenticityProven: false,
    });
  });

  it("parses export create, grant, and redeem RPCs", async () => {
    const artifact = {
      sha256,
      objectPath,
      bytes: 9,
      contentType: "application/zip",
      manifest: auditManifest(),
    };
    const job = {
      id: jobId,
      state: "ready",
      format: "json",
      created_at: "2026-10-07T00:00:00.000Z",
      expires_at: null,
      selected_event_ids: [event.id],
      artifact,
      failure_code: null,
    };
    const repository = new SupabaseAuditExplorerRepository(
      fakeSupabase({ rpcData: job }) as never,
      fakeStorage() as never,
    );

    await expect(
      repository.createExport({
        organizationId: orgId,
        actorId,
        requestId,
        receiptId: "66666666-6666-4666-8666-666666666666",
        filters,
        allowedEntityTypes: ["organization"],
        filterDigest: "a".repeat(64),
        scopeDigest: "b".repeat(64),
        format: "json",
      }),
    ).resolves.toMatchObject({ id: jobId, rowCount: 1, packageHash: sha256 });
    await expect(
      repository.issueDownloadGrant({
        organizationId: orgId,
        actorId,
        requestId,
        jobId,
        sessionId: "77777777-7777-4777-8777-777777777777",
        grantDigest: "c".repeat(64),
      }),
    ).resolves.toMatchObject({ id: jobId, packageHash: sha256 });
    await expect(
      repository.redeemDownloadGrant({
        organizationId: orgId,
        actorId,
        requestId,
        jobId,
        sessionId: "77777777-7777-4777-8777-777777777777",
        grantDigest: "c".repeat(64),
      }),
    ).resolves.toEqual({ packageHash: sha256, objectPath, bytes: 9 });
  });
});

describe("SupabaseAuditExplorerRepository RPC error mapping", () => {
  it("maps stale, conflict, and unavailable provider failures", async () => {
    await expect(
      new SupabaseAuditExplorerRepository(
        fakeSupabase({
          rpcError: { code: "40001", message: "scope_changed" },
        }) as never,
        fakeStorage() as never,
      ).getExport({ organizationId: orgId, actorId, requestId, jobId }),
    ).rejects.toThrow("audit explorer snapshot is stale");
    await expect(
      new SupabaseAuditExplorerRepository(
        fakeSupabase({
          rpcError: { code: "23505", message: "request_conflict" },
        }) as never,
        fakeStorage() as never,
      ).getExport({ organizationId: orgId, actorId, requestId, jobId }),
    ).rejects.toThrow("audit explorer request conflict");
    await expect(
      new SupabaseAuditExplorerRepository(
        fakeSupabase({ rpcError: { code: "XX000", message: "boom" } }) as never,
        fakeStorage() as never,
      ).getExport({ organizationId: orgId, actorId, requestId, jobId }),
    ).rejects.toBeInstanceOf(AuditExplorerUnavailableError);
  });
});

function auditManifest() {
  return {
    schema: "cra.audit-export.v1",
    hashAlgorithm: "sha256",
    organizationId: orgId,
    scopeDigest: "b".repeat(64),
    filters: {
      from: "2026-10-07T00:00:00.000Z",
      to: "2026-10-07T01:00:00.000Z",
    },
    format: "json",
    generatedAt: "2026-10-07T00:00:00.000Z",
    timezone: "UTC",
    ordering: "sequence_desc_then_legacy_created_at_id_desc",
    sequenceRange: { from: "7", to: "7" },
    rowCount: 1,
    legacyCount: 0,
    proofCount: 1,
    files: [
      { name: "events.json", sha256: "1".repeat(64), bytes: 1 },
      { name: "proofs.ndjson", sha256: "2".repeat(64), bytes: 1 },
      { name: "verify.mjs", sha256: "3".repeat(64), bytes: 1 },
    ],
    completenessProven: false,
    authenticityProven: false,
  } as const;
}

it("parses custom role variants and missing permission versions", async () => {
  const repository = new SupabaseAuditExplorerRepository(
    fakeSupabase({
      fromData: {
        user_role_assignments: [
          { custom_roles: null },
          {
            custom_roles: {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              name: "Audit viewer",
              base_role: "viewer",
              permissions: { can_view_audit: true },
              is_active: true,
              is_deleted: false,
            },
          },
          {
            custom_roles: [
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                name: "Export audit",
                base_role: "viewer",
                permissions: { can_export_audit: true },
                is_active: true,
                is_deleted: false,
              },
            ],
          },
        ],
        base_role_permission_overrides: null,
        organization_permissions_version: null,
      },
    }) as never,
    fakeStorage() as never,
  );

  const result = await repository.effectivePermissions(
    orgId,
    actorId,
    "viewer",
  );

  expect(result.version).toBe("0");
  expect(result.permissions.can_view_audit).toBe(true);
});

it("fails closed when permission dependency queries fail", async () => {
  const repository = new SupabaseAuditExplorerRepository(
    fakeSupabase({ fromErrorTable: "user_role_assignments" }) as never,
    fakeStorage() as never,
  );

  await expect(
    repository.effectivePermissions(orgId, actorId, "owner"),
  ).rejects.toBeInstanceOf(AuditExplorerUnavailableError);
});

it("parses snapshot and access receipt RPC adapters", async () => {
  const snapshotRepository = new SupabaseAuditExplorerRepository(
    fakeSupabase({
      rpcData: {
        receiptId: "66666666-6666-4666-8666-666666666666",
        highWaterSequence: "10",
        expiresAt: "2026-10-07T00:30:00.000Z",
        filterDigest: "a".repeat(64),
        scopeDigest: "b".repeat(64),
        scopeVersion: 3,
      },
    }) as never,
    fakeStorage() as never,
  );
  await expect(
    snapshotRepository.createSnapshot({
      organizationId: orgId,
      actorId,
      requestId,
      filterDigest: "a".repeat(64),
      scopeDigest: "b".repeat(64),
    }),
  ).resolves.toMatchObject({ highWaterSequence: "10", scopeVersion: "3" });

  const accessRepository = new SupabaseAuditExplorerRepository(
    fakeSupabase({
      rpcData: {
        receiptId: "66666666-6666-4666-8666-666666666666",
        replayed: true,
      },
    }) as never,
    fakeStorage() as never,
  );
  await expect(
    accessRepository.recordDenial({
      organizationId: orgId,
      actorId,
      requestId,
      operationDigest: "c".repeat(64),
    }),
  ).resolves.toEqual({
    receiptId: "66666666-6666-4666-8666-666666666666",
    replayed: true,
  });
  await expect(
    accessRepository.recordAccess({
      organizationId: orgId,
      actorId,
      requestId,
      action: "audit.search.page",
      receiptId: "66666666-6666-4666-8666-666666666666",
      operationDigest: "c".repeat(64),
    }),
  ).resolves.toEqual({
    receiptId: "66666666-6666-4666-8666-666666666666",
    replayed: true,
  });
});
