import { SupabaseSyncOperationsRepository } from "./supabase-sync-operations.repository";
import type { SupabaseService } from "../../supabase/supabase.service";
describe("sync operations storage boundary", () => {
  it("scopes current mappings by organization and connector", async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { field_mapping_revision: 1, field_map: [] },
        error: null,
      }),
    };
    const from = jest.fn().mockReturnValue(query);
    const repo = new SupabaseSyncOperationsRepository({
      admin: () => ({ from }),
    } as unknown as SupabaseService);
    expect(await repo.currentMapping("org", "connector")).toEqual({
      revision: 1,
      fields: [],
    });
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(query.eq).toHaveBeenCalledWith("id", "connector");
  });
  it("does not leak database failures", async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: "canary" } }),
    };
    const repo = new SupabaseSyncOperationsRepository({
      admin: () => ({ from: () => query }),
    } as unknown as SupabaseService);
    await expect(repo.currentMapping("org", "connector")).rejects.toThrow(
      "unavailable",
    );
  });
});
const orgId = "11111111-1111-4111-8111-111111111111",
  connectorId = "22222222-2222-4222-8222-222222222222",
  runId = "33333333-3333-4333-8333-333333333333",
  actorId = "44444444-4444-4444-8444-444444444444",
  now = "2026-09-29T00:00:00Z";
const runRow = {
  id: runId,
  organization_id: orgId,
  connector_id: connectorId,
  reconciliation_kind: "incremental",
  work_kind: "dry_run",
  status: "failed",
  adapter_version: "1.0.0",
  mapping_version: "v1",
  cursor_from: null,
  cursor_to: null,
  fetch_content_hash: null,
  plan_basis_digest: null,
  row_count: 1,
  create_count: 1,
  update_count: 0,
  unchanged_count: 0,
  skip_count: 0,
  conflict_count: 0,
  tombstone_count: 0,
  cycle_blocked_count: 0,
  estimated_graph_impact: {},
  retry_count: 0,
  error_code: "canary",
  correlation_id: actorId,
  expires_at: now,
  committed_at: null,
  canceled_at: null,
  created_at: now,
  updated_at: now,
  started_at: now,
  finished_at: now,
  version: 1,
  field_mapping_revision: 0,
  replay_parent_run_id: null,
  succeeded_count: 0,
  skipped_count: 0,
  failed_count: 1,
  pending_count: 0,
  next_attempt_at: null,
};
const recordRow = {
  id: actorId,
  sync_run_id: runId,
  external_id: "one",
  entity_type: "product",
  proposed_action: "rejected",
  record_outcome: "failed",
  error_category: "invalid_data",
  error_code: "invalid_value",
  dead_lettered_at: now,
  applied_at: null,
  source_snapshot: { secret: "canary" },
};
const attemptRow = {
  id: actorId,
  sync_run_id: runId,
  lease_generation: 1,
  phase: "dry_run",
  started_at: now,
  finished_at: now,
  outcome: "failed",
  error_category: "invalid_data",
  error_code: "invalid_value",
  next_attempt_at: null,
  affected_record_ids: [actorId],
};
const authorization = {
  organizationId: orgId,
  actorId,
  permissionVersion: 1,
  role: "owner" as const,
};
const previewInput = {
  expectedVersion: 1,
  mappingMode: "preserve" as const,
  sourceMode: "retained" as const,
};
const replayInput = {
  ...previewInput,
  idempotencyKey: actorId,
  previewDigest: "a".repeat(64),
  reason: "Reviewed",
};
const fingerprint = { digest: "b".repeat(64), keyId: "key-1" };
const query = { page: 1, pageSize: 15 };
function setup() {
  const reads: { data: unknown; error: unknown; count?: number }[] = [];
  const traces: { table: string; method: string; args: unknown[] }[] = [];
  const rpc = jest.fn();
  const client = {
    rpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "not", "order", "range"])
        chain[method] = (...args: unknown[]) => {
          traces.push({ table, method, args });
          return chain;
        };
      chain.maybeSingle = () =>
        Promise.resolve(reads.shift() ?? { data: null, error: null });
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (value: unknown) => unknown,
      ) =>
        Promise.resolve(reads.shift() ?? { data: [], error: null }).then(
          resolve,
          reject,
        );
      return chain;
    },
  };
  return {
    repo: new SupabaseSyncOperationsRepository({
      admin: () => client,
    } as unknown as SupabaseService),
    reads,
    traces,
    rpc,
  };
}
describe("paged durable history and commands", () => {
  it("projects history without source data, secrets or provider messages", async () => {
    const { repo, reads, traces } = setup();
    reads.push(
      { data: { field_mapping_revision: 0, field_map: [] }, error: null },
      { data: [runRow], error: null, count: 1 },
    );
    const result = await repo.history(orgId, connectorId, query);
    expect(result.rows[0]?.run.errorCode).toBe("unknown");
    expect(result.total).toBe(1);
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(traces).toContainEqual({
      table: "sync_runs",
      method: "eq",
      args: ["organization_id", orgId],
    });
    expect(traces).toContainEqual({
      table: "sync_runs",
      method: "range",
      args: [0, 14],
    });
  });
  it("scopes detail children through a verified parent", async () => {
    const { repo, reads, traces } = setup();
    reads.push(
      { data: runRow, error: null },
      { data: [attemptRow], error: null, count: 1 },
      { data: [recordRow], error: null, count: 1 },
    );
    const result = await repo.detail(orgId, connectorId, runId, query);
    expect(result.attempts.rows[0]?.recordIds).toEqual([actorId]);
    expect(result.records.rows[0]?.errorCode).toBe("invalid_value");
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(traces).toContainEqual({
      table: "sync_run_attempts",
      method: "eq",
      args: ["organization_id", orgId],
    });
    expect(traces).toContainEqual({
      table: "sync_run_plan_items",
      method: "eq",
      args: ["sync_run_id", runId],
    });
  });
  it("reports a currently running attempt without inventing completion", async () => {
    const { repo, reads } = setup();
    reads.push(
      { data: runRow, error: null },
      {
        data: [
          {
            ...attemptRow,
            outcome: null,
            finished_at: null,
            error_code: null,
            affected_record_ids: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    const result = await repo.detail(orgId, connectorId, runId, query);
    expect(result.attempts.rows[0]?.outcome).toBe("running");
    expect(result.attempts.rows[0]?.finishedAt).toBeNull();
  });
  it("projects a completed planning attempt that requires manual review", async () => {
    const { repo, reads } = setup();
    reads.push(
      { data: { ...runRow, status: "waiting_for_review" }, error: null },
      {
        data: [
          {
            ...attemptRow,
            outcome: "review_required",
            error_category: null,
            error_code: null,
          },
        ],
        error: null,
        count: 1,
      },
      { data: [], error: null },
    );
    const result = await repo.detail(orgId, connectorId, runId, query);
    expect(result.attempts.rows[0]?.outcome).toBe("review_required");
    expect(result.attempts.rows[0]?.finishedAt).toBe(
      new Date(now).toISOString(),
    );
  });
  it("joins dead letters to the tenant scoped connector", async () => {
    const { repo, reads, traces } = setup();
    reads.push(
      { data: { field_mapping_revision: 0, field_map: [] }, error: null },
      { data: [recordRow], error: null, count: 1 },
    );
    expect(
      (await repo.deadLetters(orgId, connectorId, query)).rows,
    ).toHaveLength(1);
    expect(traces).toContainEqual({
      table: "sync_run_plan_items",
      method: "is",
      args: ["dead_letter_resolved_at", null],
    });
    expect(traces).toContainEqual({
      table: "sync_run_plan_items",
      method: "eq",
      args: ["sync_runs.organization_id", orgId],
    });
    expect(traces).toContainEqual({
      table: "sync_run_plan_items",
      method: "eq",
      args: ["sync_runs.connector_id", connectorId],
    });
  });
  it("sends durable mapping fences and parses the result", async () => {
    const { repo, rpc } = setup();
    rpc.mockResolvedValue({ data: { revision: 1, fields: [] }, error: null });
    await expect(
      repo.saveMapping(
        orgId,
        connectorId,
        authorization,
        {
          expectedVersion: 2,
          expectedMappingRevision: 0,
          idempotencyKey: actorId,
          schemaDigest: "a".repeat(64),
          fields: [],
        },
        fingerprint,
      ),
    ).resolves.toEqual({ revision: 1, fields: [] });
    expect(rpc).toHaveBeenCalledWith(
      "m1102_save_field_mapping",
      expect.objectContaining({
        p_org_id: orgId,
        p_actor_id: actorId,
        p_permission_version: 1,
        p_expected_version: 2,
        p_request_digest: fingerprint.digest,
      }),
    );
  });
  it("parses safe replay eligibility and original plan summaries", async () => {
    const { repo, rpc } = setup();
    const preview = {
      previewDigest: "a".repeat(64),
      runId,
      runVersion: 1,
      mappingRevision: 0,
      mappingMode: "preserve",
      sourceMode: "retained",
      recordCount: 1,
      proposedCounts: {
        create: 0,
        update: 0,
        unchanged: 0,
        skip: 0,
        conflict: 0,
        failed: 1,
      },
      samples: [],
      issues: [],
      canReplay: true,
    };
    rpc.mockResolvedValue({ data: preview, error: null });
    expect(
      await repo.replayPreview(
        orgId,
        connectorId,
        runId,
        authorization,
        previewInput,
      ),
    ).toEqual(preview);
  });
  it("returns child run using the legacy strict projection", async () => {
    const { repo, rpc } = setup();
    const source = setup();
    source.reads.push(
      { data: { field_mapping_revision: 0, field_map: [] }, error: null },
      { data: [{ ...runRow, status: "queued" }], error: null, count: 1 },
    );
    const wireRun = (await source.repo.history(orgId, connectorId, query))
      .rows[0]!.run;
    rpc.mockResolvedValue({
      data: [{ outcome: "queued", run: wireRun }],
      error: null,
    });
    const result = await repo.replay(
      orgId,
      connectorId,
      runId,
      authorization,
      replayInput,
      fingerprint,
    );
    expect(result.status).toBe("queued");
    expect(result).not.toHaveProperty("source_snapshot");
    expect(rpc).toHaveBeenCalledWith(
      "m1102_replay_sync_run",
      expect.objectContaining({
        p_preview_digest: replayInput.previewDigest,
        p_idempotency_key: actorId,
      }),
    );
  });
  it.each([
    "conflict",
    "stale_preview",
    "not_found",
    "forbidden",
    "invalid_request",
    "already_running",
    "idempotency_conflict",
    "unknown",
  ])("maps %s outcomes safely", async (outcome) => {
    const { repo, rpc } = setup();
    rpc.mockResolvedValue({ data: { outcome }, error: null });
    await expect(
      repo.replay(
        orgId,
        connectorId,
        runId,
        authorization,
        replayInput,
        fingerprint,
      ),
    ).rejects.toThrow("Connector request failed:");
  });
  it("rejects tenant substitution before RPC", async () => {
    const { repo, rpc } = setup();
    await expect(
      repo.replay(
        orgId,
        connectorId,
        runId,
        { ...authorization, organizationId: actorId },
        replayInput,
        fingerprint,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["throw", "error", "malformed"])(
    "handles %s RPC failure safely",
    async (kind) => {
      const { repo, rpc } = setup();
      if (kind === "throw") rpc.mockRejectedValue(new Error("canary"));
      if (kind === "error")
        rpc.mockResolvedValue({ data: null, error: { message: "canary" } });
      if (kind === "malformed")
        rpc.mockResolvedValue({ data: null, error: null });
      await expect(
        repo.replay(
          orgId,
          connectorId,
          runId,
          authorization,
          replayInput,
          fingerprint,
        ),
      ).rejects.toMatchObject({ code: "unavailable" });
    },
  );
  it.each(["notfound", "error"])(
    "does not query children after %s parent",
    async (kind) => {
      const { repo, reads, traces } = setup();
      reads.push({
        data: null,
        error: kind === "error" ? { message: "canary" } : null,
      });
      await expect(
        repo.detail(orgId, connectorId, runId, query),
      ).rejects.toMatchObject({
        code: kind === "error" ? "unavailable" : "not_found",
      });
      expect(
        traces.some((trace) => trace.table === "sync_run_plan_items"),
      ).toBe(false);
    },
  );
  it("fails closed when a history list cannot be parsed", async () => {
    const { repo, reads } = setup();
    reads.push(
      { data: { field_mapping_revision: 0, field_map: [] }, error: null },
      { data: null, error: null },
    );
    await expect(repo.history(orgId, connectorId, query)).rejects.toMatchObject(
      { code: "unavailable" },
    );
  });
  it("fails closed on history database errors", async () => {
    const { repo, reads } = setup();
    reads.push(
      { data: { field_mapping_revision: 0, field_map: [] }, error: null },
      { data: [], error: { message: "canary" } },
    );
    await expect(repo.history(orgId, connectorId, query)).rejects.toMatchObject(
      { code: "unavailable" },
    );
  });
  it("does not invent a mapping for an unknown connector", async () => {
    const { repo, reads } = setup();
    reads.push({ data: null, error: null });
    await expect(repo.currentMapping(orgId, connectorId)).rejects.toMatchObject(
      { code: "not_found" },
    );
  });
});

describe("structured database command conflicts", () => {
  it.each([
    ["conflict", "conflict"],
    ["forbidden", "forbidden_by_policy"],
    ["idempotency_conflict", "idempotency_mismatch"],
    ["not_found", "not_found"],
    ["invalid_request", "invalid_request"],
  ])(
    "maps exact %s SQL signals without upstream text",
    async (message, code) => {
      const { repo, rpc } = setup();
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
      await expect(
        repo.saveMapping(
          orgId,
          connectorId,
          authorization,
          {
            expectedVersion: 1,
            expectedMappingRevision: 0,
            idempotencyKey: actorId,
            schemaDigest: "a".repeat(64),
            fields: [],
          },
          fingerprint,
        ),
      ).rejects.toMatchObject({ code });
    },
  );
  it("does not expose arbitrary SQL messages even with the same code", async () => {
    const { repo, rpc } = setup();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "canary-secret conflict" },
    });
    await expect(
      repo.replay(
        orgId,
        connectorId,
        runId,
        authorization,
        replayInput,
        fingerprint,
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
