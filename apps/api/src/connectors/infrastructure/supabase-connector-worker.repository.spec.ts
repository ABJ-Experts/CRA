import { SupabaseConnectorRepository } from "./supabase-connector.repository";

describe("connector worker generation-scoped RPC transport", () => {
  function fixture() {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "claimed", run: { id: "run" } }],
      error: null,
    });
    return {
      rpc,
      repository: new SupabaseConnectorRepository({
        admin: () => ({ rpc }),
      } as never),
    };
  }
  it("claims using the recoverable tenant-scoped worker bridge", async () => {
    const { repository, rpc } = fixture();
    expect(await repository.claimSyncRun("org", "worker", 60)).toEqual({
      id: "run",
    });
    expect(rpc).toHaveBeenCalledWith("m1102_claim_sync_run", {
      p_organization_id: "org",
      p_worker_id: "worker",
      p_lease_seconds: 60,
    });
    rpc.mockResolvedValue({ data: [{ outcome: "not_found" }], error: null });
    expect(await repository.claimSyncRun("org", "worker", 60)).toBeNull();
  });
  it("persists schema, record snapshots and commit generation through the dedicated bridge", async () => {
    const { repository, rpc } = fixture();
    const args = {
      p_organization_id: "org",
      p_sync_run_id: "run",
      p_worker_id: "worker",
      p_generation: 7,
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "saved", run: { id: "run" } }],
      error: null,
    });
    await repository.saveSyncRunPlan(args);
    expect(rpc).toHaveBeenCalledWith("m1102_save_sync_run_plan_atomic", args);
    rpc.mockResolvedValue({ data: [{ outcome: "completed" }], error: null });
    await repository.commitSyncRun(args);
    expect(rpc).toHaveBeenCalledWith("m1102_commit_sync_run_atomic", args);
    await repository.failSyncRun(
      "org",
      "run",
      "worker",
      "rate_limited",
      7,
      true,
      900,
    );
    expect(rpc).toHaveBeenCalledWith("m1102_fail_sync_run_atomic", {
      ...args,
      p_error_code: "rate_limited",
      p_retryable: true,
      p_retry_after_seconds: 900,
    });
  });
  it("revalidates renewal generation and fails closed on unavailable or malformed storage", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValue({ data: true, error: null });
    expect(
      await repository.renewSyncRunLease("org", "run", "worker", 7, 60),
    ).toBe(true);
    expect(rpc).toHaveBeenCalledWith("m1102_renew_sync_run_lease", {
      p_organization_id: "org",
      p_sync_run_id: "run",
      p_worker_id: "worker",
      p_generation: 7,
      p_lease_seconds: 60,
    });
    for (const result of [
      { data: "true", error: null },
      { data: null, error: { message: "private canary" } },
    ]) {
      rpc.mockResolvedValue(result);
      await expect(
        repository.renewSyncRunLease("org", "run", "worker", 7, 60),
      ).rejects.toMatchObject({ code: "unavailable" });
    }
    rpc.mockRejectedValue(new Error("private canary"));
    await expect(
      repository.renewSyncRunLease("org", "run", "worker", 7, 60),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("drops lost leases and rejects schema changes without scheduling an outage retry", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValue({ data: [{ outcome: "lease_lost" }], error: null });
    expect(await repository.saveSyncRunPlan({})).toBeNull();
    rpc.mockResolvedValue({
      data: [{ outcome: "schema_changed" }],
      error: null,
    });
    await expect(repository.saveSyncRunPlan({})).rejects.toMatchObject({
      code: "stale_preview",
    });
    rpc.mockResolvedValue({ data: [{ outcome: "invalid_data" }], error: null });
    await expect(repository.saveSyncRunPlan({})).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});
