/* eslint-disable @typescript-eslint/require-await */
import { SupabaseAuditExportJobRepository } from "./supabase-audit-export-job.repository";

const baseJob = {
  id: "44444444-4444-4444-8444-444444444444",
  organization_id: "33333333-3333-4333-8333-333333333333",
  requester_id: "55555555-5555-4555-8555-555555555555",
  worker_id: "worker-1",
  version: 3,
  format: "json",
  filters: {
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-08T00:00:00.000Z",
    allowedEntityTypes: ["audit_search"],
  },
  scope_digest: "11".repeat(32),
  selected_event_ids: ["11111111-1111-4111-8111-111111111111"],
};

describe("SupabaseAuditExportJobRepository", () => {
  it("parses claimed jobs with shared filter schema and snake-case DB fields", async () => {
    const calls: unknown[] = [];
    const repository = new SupabaseAuditExportJobRepository(
      fakeSupabase(calls, baseJob) as never,
    );
    await expect(repository.claim("worker-1")).resolves.toMatchObject({
      id: baseJob.id,
      actorUserId: baseJob.requester_id,
      leaseOwner: baseJob.worker_id,
      checkpointVersion: baseJob.version,
      selectedIds: baseJob.selected_event_ids,
    });
    expect(calls).toContainEqual([
      "m13_03_claim_export",
      { p_worker_id: "worker-1" },
    ]);
  });

  it("returns idle on empty claims and preserves all public filter fields", async () => {
    await expect(
      new SupabaseAuditExportJobRepository(
        fakeSupabase([], null) as never,
      ).claim("worker-1"),
    ).resolves.toBeNull();

    const calls: unknown[] = [];
    const repository = new SupabaseAuditExportJobRepository(
      fakeSupabase(calls, {
        ...baseJob,
        filters: {
          from: "2026-10-01T00:00:00.000Z",
          to: "2026-10-08T00:00:00.000Z",
          actorId: "actor-1",
          action: "audit.read",
          resourceType: "audit_log",
          resourceId: "row-1",
          correlationId: "22222222-2222-4222-8222-222222222222",
          allowedEntityTypes: ["audit_search"],
        },
      }) as never,
    );
    await expect(repository.claim("worker-1")).resolves.toMatchObject({
      filters: {
        actorId: "actor-1",
        action: "audit.read",
        resourceType: "audit_log",
        resourceId: "row-1",
        correlationId: "22222222-2222-4222-8222-222222222222",
      },
    });
  });

  it("rejects malformed filter payloads before worker use", async () => {
    const repository = new SupabaseAuditExportJobRepository(
      fakeSupabase([], {
        ...baseJob,
        filters: { from: "bad", to: "also-bad" },
      }) as never,
    );
    await expect(repository.claim("worker-1")).rejects.toThrow();
  });

  it("maps recomputed canonical content from event rows", async () => {
    const calls: unknown[] = [];
    const repository = new SupabaseAuditExportJobRepository(
      fakeSupabase(calls, [
        {
          id: "11111111-1111-4111-8111-111111111111",
          sequence: "7",
          previous_hash: "00".repeat(32),
          content_hash: "11".repeat(32),
          canonical_content: "public",
          recomputed_canonical_content: "private",
          canonical_disclosable: true,
          legacy: false,
          created_at: "2026-10-07T00:00:00.000Z",
          actor_id: null,
          actor_type: "user",
          actor_label: null,
          action: "audit.read",
          resource_type: "audit_log",
          resource_id: null,
          correlation_id: null,
          outcome: null,
          before: null,
          after: null,
          reason: null,
        },
      ]) as never,
    );
    await expect(
      repository.events(
        {
          id: baseJob.id,
          organizationId: baseJob.organization_id,
          actorUserId: baseJob.requester_id,
          leaseOwner: baseJob.worker_id,
          checkpointVersion: baseJob.version,
          format: "json",
          filters: baseJob.filters,
          scopeDigest: baseJob.scope_digest,
          selectedIds: baseJob.selected_event_ids,
        },
        0,
        250,
      ),
    ).resolves.toMatchObject([
      { canonicalContent: "public", recomputedCanonicalContent: "private" },
    ]);
    expect(calls).toContainEqual([
      "m13_03_read_export_events",
      expect.objectContaining({ p_organization_id: baseJob.organization_id }),
    ]);
  });

  it("uses queued transitions for retryable failures and failed transitions for terminal failures", async () => {
    const calls: unknown[] = [];
    const repository = new SupabaseAuditExportJobRepository(
      fakeSupabase(calls, { outcome: "queued" }) as never,
    );
    const parsedJob = {
      id: baseJob.id,
      organizationId: baseJob.organization_id,
      actorUserId: baseJob.requester_id,
      leaseOwner: baseJob.worker_id,
      checkpointVersion: baseJob.version,
      format: "json" as const,
      filters: baseJob.filters,
      scopeDigest: baseJob.scope_digest,
      selectedIds: baseJob.selected_event_ids,
    };
    await repository.fail({
      job: parsedJob,
      code: "storage_unavailable",
      retryable: true,
    });
    expect(calls.at(-1)).toEqual([
      "m13_03_transition_export",
      expect.objectContaining({
        p_next_state: "queued",
        p_failure_code: "storage_unavailable",
      }),
    ]);
    await repository.fail({
      job: parsedJob,
      code: "access_changed",
      retryable: false,
    });
    expect(calls.at(-1)).toEqual([
      "m13_03_transition_export",
      expect.objectContaining({
        p_next_state: "failed",
        p_failure_code: "access_changed",
      }),
    ]);
  });

  it("heartbeats processing leases and parses the incremented version", async () => {
    const calls: unknown[] = [];
    const repository = new SupabaseAuditExportJobRepository(
      fakeSupabase(calls, { ...baseJob, version: 4 }) as never,
    );
    await expect(
      repository.heartbeat({
        id: baseJob.id,
        organizationId: baseJob.organization_id,
        actorUserId: baseJob.requester_id,
        leaseOwner: baseJob.worker_id,
        checkpointVersion: 3,
        format: "json",
        filters: baseJob.filters,
        scopeDigest: baseJob.scope_digest,
        selectedIds: baseJob.selected_event_ids,
      }),
    ).resolves.toMatchObject({ checkpointVersion: 4 });
    expect(calls.at(-1)).toEqual([
      "m13_03_transition_export",
      expect.objectContaining({
        p_next_state: "processing",
        p_expected_version: 3,
      }),
    ]);
  });

  it("maps all supported transition result shapes and surfaces provider errors", async () => {
    const parsedJob = {
      id: baseJob.id,
      organizationId: baseJob.organization_id,
      actorUserId: baseJob.requester_id,
      leaseOwner: baseJob.worker_id,
      checkpointVersion: baseJob.version,
      format: "json" as const,
      filters: baseJob.filters,
      scopeDigest: baseJob.scope_digest,
      selectedIds: baseJob.selected_event_ids,
    };
    for (const [payload, expected] of [
      [{ outcome: "conflict" }, "conflict"],
      [{ status: "not_found" }, "not_found"],
      [{ state: "invalid_state" }, "invalid_state"],
    ] as const) {
      const repository = new SupabaseAuditExportJobRepository(
        fakeSupabase([], payload) as never,
      );
      await expect(
        repository.complete({
          job: parsedJob,
          selectedIds: parsedJob.selectedIds,
          artifact: {
            objectPath: "p",
            sha256: "11".repeat(32),
            byteSize: 1,
            contentType: "application/zip",
            manifest: {} as never,
          },
        }),
      ).resolves.toBe(expected);
    }

    const unavailable = new SupabaseAuditExportJobRepository(
      fakeSupabase([], null, "down") as never,
    );
    await expect(unavailable.claim("worker-1")).rejects.toThrow(
      "provider_unavailable",
    );
  });

  it("maps ready completion and rejects malformed transition outcomes", async () => {
    const parsedJob = {
      id: baseJob.id,
      organizationId: baseJob.organization_id,
      actorUserId: baseJob.requester_id,
      leaseOwner: baseJob.worker_id,
      checkpointVersion: baseJob.version,
      format: "json" as const,
      filters: baseJob.filters,
      scopeDigest: baseJob.scope_digest,
      selectedIds: baseJob.selected_event_ids,
    };
    const ok = new SupabaseAuditExportJobRepository(
      fakeSupabase([], { ...baseJob, state: "ready" }) as never,
    );
    await expect(
      ok.complete({
        job: parsedJob,
        selectedIds: parsedJob.selectedIds,
        artifact: {
          objectPath: "p",
          sha256: "11".repeat(32),
          byteSize: 1,
          contentType: "application/zip",
          manifest: {} as never,
        },
      }),
    ).resolves.toBe("completed");
    const bad = new SupabaseAuditExportJobRepository(
      fakeSupabase([], { ...baseJob, state: "weird" }) as never,
    );
    await expect(
      bad.complete({
        job: parsedJob,
        selectedIds: parsedJob.selectedIds,
        artifact: {
          objectPath: "p",
          sha256: "11".repeat(32),
          byteSize: 1,
          contentType: "application/zip",
          manifest: {} as never,
        },
      }),
    ).rejects.toThrow("malformed_provider");
  });
});

function fakeSupabase(calls: unknown[], data: unknown, error?: string) {
  return {
    admin: () => ({
      rpc: async (name: string, args: unknown) => {
        calls.push([name, args]);
        return { data, error: error ? { message: error } : null };
      },
    }),
  };
}
