import { SupabaseAuditRangeRepository } from "./supabase-audit-range.repository";
import {
  AuditRangeLimitError,
  AuditRangeInputError,
  AuditRangeConflictError,
  AuditRangeNotFoundError,
  AuditRangeUnavailableError,
} from "../audit-range.errors";
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  status: "queued",
  version: 0,
  createdAt: "2026-10-07T00:00:00Z",
  updatedAt: "2026-10-07T00:00:00Z",
  result: null,
  failureCode: null,
};
describe("SupabaseAuditRangeRepository public boundary", () => {
  const rpc = jest.fn<
    Promise<{ data: unknown; error: unknown }>,
    [string, Record<string, unknown>]
  >();
  const repository = new SupabaseAuditRangeRepository({
    admin: () => ({ rpc }),
  } as never);
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: row, error: null });
  });
  it("scopes creation and hashes normalized criteria", async () => {
    const result = await repository.create(id, id, {
      requestId: id,
      fromSequence: "1",
    });
    expect(result).toEqual({
      id,
      status: "queued",
      version: 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      result: null,
      failureCode: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "m13_04_create_verification",
      expect.objectContaining({
        p_organization_id: id,
        p_actor_user_id: id,
        p_to_sequence: null,
        p_checkpoint: null,
        p_request_digest: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
      }),
    );
  });
  it("forwards checkpoint and all scoped operations", async () => {
    await repository.create(id, id, {
      requestId: id,
      fromSequence: "1",
      toSequence: "2",
      priorCheckpoint: {
        organizationId: id,
        activationAt: row.createdAt,
        chainVersion: 1,
        sequence: "1",
        hash: "a".repeat(64),
      },
    });
    await repository.status(id, id, id, id);
    await repository.cancel(id, id, id, { requestId: id, expectedVersion: 1 });
    await repository.resume(id, id, id, { requestId: id, expectedVersion: 2 });
    rpc.mockResolvedValue({
      data: { receiptId: id },
      error: null,
    });
    await repository.recordDenial(id, id, id, "a".repeat(64));
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "m13_04_create_verification",
      "m13_04_read_verification",
      "m13_04_control_verification",
      "m13_04_control_verification",
      "m13_04_record_denial",
    ]);
  });
  it.each([
    ["22023", AuditRangeInputError],
    ["54000", AuditRangeConflictError],
    ["40001", AuditRangeConflictError],
    ["23505", AuditRangeConflictError],
    ["P0002", AuditRangeNotFoundError],
    ["42501", AuditRangeNotFoundError],
    ["XX000", AuditRangeUnavailableError],
  ])("maps provider %s safely", async (code, error) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code, message: "sensitive" },
    });
    await expect(repository.status(id, id, id, id)).rejects.toBeInstanceOf(
      error,
    );
  });
  it("sanitizes rejected network transport failures", async () => {
    rpc.mockRejectedValue(new Error("https://bearer-secret.example.invalid"));
    await expect(repository.status(id, id, id, id)).rejects.toBeInstanceOf(
      AuditRangeUnavailableError,
    );
  });
  it("rejects malformed durable denial acknowledgements", async () => {
    rpc.mockResolvedValue({ data: { receiptId: "bad" }, error: null });
    await expect(
      repository.recordDenial(id, id, id, "a".repeat(64)),
    ).rejects.toBeInstanceOf(AuditRangeUnavailableError);
  });
  it("rejects malformed successful provider values", async () => {
    rpc.mockResolvedValue({ data: { ...row, status: "green" }, error: null });
    await expect(repository.status(id, id, id, id)).rejects.toBeInstanceOf(
      AuditRangeUnavailableError,
    );
  });
});

const rawWorkerJob = {
  id,
  organization_id: id,
  worker_id: id,
  lease_token: id,
  version: 1,
  phase: "verification",
  from_sequence: "1",
  to_sequence: "2",
  requested_to_sequence: null,
  frozen_head: {
    last_sequence: "2",
    last_hash: "a".repeat(64),
    last_event_id: id,
  },
  frozen_boundary: null,
  predecessor: null,
  cursor: null,
  dataset_context: "unknown",
  legacy_count: "0",
  prior_checkpoint: null,
  prior_checkpoint_status: "not_supplied",
};
describe("SupabaseAuditRangeRepository leased worker boundary", () => {
  const rpc = jest.fn<
    Promise<{ data: unknown; error: unknown }>,
    [string, Record<string, unknown>]
  >();
  const repository = new SupabaseAuditRangeRepository({
    admin: () => ({ rpc }),
  } as never);
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: rawWorkerJob, error: null });
  });
  it("claims parsed scoped work or returns idle", async () => {
    const job = await repository.claim(id);
    expect(job).toMatchObject({
      organizationId: id,
      leaseToken: id,
      workerId: id,
      head: { sequence: "2", hash: "a".repeat(64), eventId: id },
    });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await repository.claim(id)).toBeNull();
  });
  it("parses nullable head and prior checkpoint without canonical leakage", async () => {
    rpc.mockResolvedValue({
      data: {
        ...rawWorkerJob,
        frozen_head: null,
        prior_checkpoint: {
          organizationId: id,
          chainVersion: 1,
          activationAt: row.createdAt,
          sequence: "1",
          hash: "b".repeat(64),
        },
      },
      error: null,
    });
    expect(await repository.claim(id)).toMatchObject({
      head: null,
      priorCheckpoint: { sequence: "1", hash: "b".repeat(64), eventId: null },
    });
  });
  it("parses terminal bigint cursor and rejects overflow without numeric coercion", async () => {
    const cursor = {
      nextSequence: "9223372036854775808",
      previousHash: "a".repeat(64),
      lastEventId: id,
      checkedCount: "1",
      checkedFrom: "9223372036854775807",
      checkedTo: "9223372036854775807",
      verifiedPrefixTo: "9223372036854775807",
      breaks: [],
      sampleSequences: [],
      exhausted: true,
    };
    rpc.mockResolvedValue({ data: { ...rawWorkerJob, cursor }, error: null });
    expect((await repository.claim(id))?.cursor?.nextSequence).toBe(
      "9223372036854775808",
    );
    rpc.mockResolvedValue({
      data: {
        ...rawWorkerJob,
        cursor: { ...cursor, nextSequence: "9223372036854775809" },
      },
      error: null,
    });
    await expect(repository.claim(id)).rejects.toBeInstanceOf(
      AuditRangeUnavailableError,
    );
  });
  it("forwards organization and fenced lease on every worker transition", async () => {
    const job = (await repository.claim(id))!;
    rpc.mockResolvedValue({
      data: { job: rawWorkerJob, complete: true, scopeAvailable: true },
      error: null,
    });
    expect(await repository.authorizeBatch(job, 250, 16777216)).toMatchObject({
      complete: true,
      scopeAvailable: true,
    });
    rpc.mockResolvedValue({
      data: { job: rawWorkerJob, anchorsValid: true, scopeAvailable: true },
      error: null,
    });
    await repository.revalidate(job);
    rpc.mockResolvedValue({ data: { rows: [], exhausted: true }, error: null });
    await repository.page(job, "0", "2", 250, 16777216);
    rpc.mockResolvedValue({
      data: {
        ...rawWorkerJob,
        worker_id: null,
        lease_token: null,
        state: "queued",
        result: null,
        failure_code: null,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
      error: null,
    });
    await repository.checkpoint(job, null, null);
    await repository.finishUnavailable(job, "scope_unavailable");
    await repository.fail(job, "provider_unavailable", true);
    for (const call of rpc.mock.calls.slice(1))
      expect(call[1]).toMatchObject({
        p_organization_id: id,
        p_job_id: id,
        p_worker_id: id,
        p_lease_token: id,
        p_expected_version: 1,
      });
  });
  it.each([
    ["verification byte limit", "byte_limit"],
    ["verification event limit", "event_limit"],
  ])(
    "classifies known worker bound %s as a safe terminal limit",
    async (message, code) => {
      const job = (await repository.claim(id))!;
      rpc.mockResolvedValue({ data: null, error: { code: "54000", message } });
      await expect(
        repository.page(job, "0", "2", 250, 16777216),
      ).rejects.toMatchObject({ code });
      await expect(
        repository.authorizeBatch(job, 250, 16777216),
      ).rejects.toBeInstanceOf(AuditRangeLimitError);
    },
  );
  it("does not convert unknown worker provider messages into limit details", async () => {
    const job = (await repository.claim(id))!;
    rpc.mockResolvedValue({
      data: null,
      error: { code: "54000", message: "bearer secret" },
    });
    await expect(
      repository.page(job, "0", "2", 250, 16777216),
    ).rejects.toBeInstanceOf(AuditRangeUnavailableError);
  });
  it("rejects malformed worker results", async () => {
    const job = (await repository.claim(id))!;
    rpc.mockResolvedValue({ data: { rows: "hidden" }, error: null });
    await expect(
      repository.page(job, "0", "2", 250, 16777216),
    ).rejects.toBeInstanceOf(AuditRangeUnavailableError);
  });
});
