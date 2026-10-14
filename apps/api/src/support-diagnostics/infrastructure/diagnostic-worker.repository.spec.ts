import { DiagnosticWorkerRepositoryAdapter } from "./diagnostic-worker.repository";
const id = "11111111-1111-4111-8111-111111111111",
  at = "2026-10-14T00:00:00.000Z";
const job = {
  id,
  organizationId: id,
  state: "running",
  stage: "collecting",
  version: 1,
  consentedAt: at,
  createdAt: at,
  completedAt: null,
  expiresAt: null,
  selection: { categories: ["logs"], from: "2026-10-13T00:00:00.000Z", to: at },
  progress: { completed: 0, total: 1 },
  omissions: [],
  artifact: null,
  failureCode: null,
  cleanup: { state: "none", blockers: [] },
};
const claim = {
  job,
  creatorUserId: id,
  sessionId: id,
  permissionVersion: "1",
  objectPath: `${id}/${id}/attempt-1/bundle.zip`,
  objectPaths: [`${id}/${id}/attempt-1/bundle.zip`],
};
function fixture() {
  const rpc = jest
    .fn()
    .mockResolvedValue({ data: { outcome: "ok", result: claim }, error: null });
  return {
    rpc,
    adapter: new DiagnosticWorkerRepositoryAdapter(
      { adminWithSignal: () => ({ rpc }) } as never,
      "worker",
    ),
  };
}
describe("diagnostic worker scoped RPC boundary", () => {
  it("parses claim and sends worker identity", async () => {
    const f = fixture();
    expect(await f.adapter.claim()).toEqual(claim);
    expect(f.rpc).toHaveBeenCalledWith("m15_04_claim", {
      p_worker_id: "worker",
    });
    expect(await f.adapter.claimCleanup()).toEqual(claim);
  });
  it("scopes all lease checks by org/job/version and worker", async () => {
    const f = fixture();
    const c = claim as never;
    for (const op of [
      () => f.adapter.authorize(c),
      () => f.adapter.heartbeat(c),
      () => f.adapter.authorizeCleanup(c),
      () => f.adapter.checkpoint(c, "redacting", 1, []),
    ])
      expect(await op()).toEqual(claim);
    for (const [, args] of f.rpc.mock.calls)
      expect(args).toEqual(
        expect.objectContaining({
          p_organization_id: id,
          p_job_id: id,
          p_expected_version: 1,
          p_worker_id: "worker",
        }),
      );
  });
  it("parses all terminal results", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({
      data: { outcome: "ok", result: job },
      error: null,
    });
    await f.adapter.complete(
      claim as never,
      {
        sha256: "a".repeat(64),
        byteSize: 1,
        fileName: `support-diagnostics-${id}.zip`,
      },
      {} as never,
    );
    await f.adapter.fail(claim as never, "source_unavailable");
    await f.adapter.finishCleanup(claim as never, true);
    expect(f.rpc).toHaveBeenCalledTimes(3);
  });
  it("parses the finite logs response", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({
      data: { outcome: "ok", result: { logs: [], omissions: [] } },
      error: null,
    });
    expect(await f.adapter.logs(claim as never)).toEqual({
      logs: [],
      omissions: [],
    });
  });
  it("allows empty claims only and fails closed on provider/malformed/denied envelopes", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: { outcome: "empty" }, error: null });
    expect(await f.adapter.claim()).toBeNull();
    expect(await f.adapter.claimCleanup()).toBeNull();
    await expect(f.adapter.authorize(claim as never)).rejects.toThrow();
    for (const result of [
      { data: null, error: { message: "private" } },
      { data: { outcome: "forbidden" }, error: null },
      { data: { outcome: "ok", result: { job: "malformed" } }, error: null },
    ]) {
      f.rpc.mockResolvedValue(result);
      await expect(f.adapter.claim()).rejects.toThrow();
    }
  });
});

it("distinguishes invalid arguments and malformed transport envelopes", async () => {
  const f = fixture();
  for (const data of [{ outcome: "invalid" }, null]) {
    f.rpc.mockResolvedValue({ data, error: null });
    await expect(f.adapter.claim()).rejects.toThrow("invalid_value");
  }
});

it("accepts a cancelled-before-claim cleanup with no object paths while keeping generation strict", async () => {
  const f = fixture();
  const cleanup = { ...claim, objectPath: null, objectPaths: [] };
  f.rpc.mockResolvedValue({
    data: { outcome: "ok", result: cleanup },
    error: null,
  });
  expect(await f.adapter.claimCleanup()).toEqual(cleanup);
  expect(await f.adapter.authorizeCleanup(cleanup as never)).toEqual(cleanup);
  await expect(f.adapter.claim()).rejects.toThrow();
});
