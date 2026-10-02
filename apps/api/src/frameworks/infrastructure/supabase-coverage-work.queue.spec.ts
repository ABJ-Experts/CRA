import { SupabaseCoverageWorkQueue } from "./supabase-coverage-work.queue";

describe("SupabaseCoverageWorkQueue", () => {
  const rpc = jest.fn();
  const queue = new SupabaseCoverageWorkQueue({
    admin: () => ({ rpc }),
  } as never);
  const workerId = "00000000-0000-4000-8000-000000000003";
  const scope = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    productId: "00000000-0000-4000-8000-000000000002",
    packKey: "cra",
    versionKey: "oj-2024-11-20-en",
  };

  beforeEach(() => rpc.mockReset());

  it("claims and recalculates an exact product/version scope", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          organization_id: scope.organizationId,
          product_id: scope.productId,
          pack_key: scope.packKey,
          version_key: scope.versionKey,
        },
      ],
      error: null,
    });
    await expect(queue.claim(workerId)).resolves.toEqual(scope);
    rpc.mockResolvedValueOnce({ data: "current", error: null });
    await expect(
      queue.recalculate(scope.organizationId, workerId, scope),
    ).resolves.toBe("current");
    expect(rpc).toHaveBeenLastCalledWith("m10_recalculate_coverage_scope", {
      p_worker_id: workerId,
      p_organization_id: scope.organizationId,
      p_product_id: scope.productId,
      p_pack_key: scope.packKey,
      p_version_key: scope.versionKey,
    });
  });

  it("reports a safe retry reason and rejects malformed RPC outcomes", async () => {
    rpc.mockResolvedValueOnce({ data: "retry", error: null });
    await expect(
      queue.fail(
        scope.organizationId,
        workerId,
        scope,
        "coverage_recalculation_failed",
      ),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenLastCalledWith(
      "m10_fail_coverage_scope",
      expect.objectContaining({
        p_organization_id: scope.organizationId,
        p_product_id: scope.productId,
        p_error: "coverage_recalculation_failed",
      }),
    );
    rpc.mockResolvedValueOnce({ data: "unknown", error: null });
    await expect(
      queue.recalculate(scope.organizationId, workerId, scope),
    ).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      queue.recalculate(
        "00000000-0000-4000-8000-000000000099",
        workerId,
        scope,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("handles an empty queue and rejects failed claims", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(queue.claim(workerId)).resolves.toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(queue.claim(workerId)).rejects.toMatchObject({ status: 503 });
    rpc.mockResolvedValueOnce({ data: [], error: { message: "offline" } });
    await expect(queue.claim(workerId)).rejects.toMatchObject({ status: 503 });
  });

  it("handles stale leases and failed recalculations without exposing scopes", async () => {
    for (const outcome of ["lease_lost", "unavailable"] as const) {
      rpc.mockResolvedValueOnce({ data: outcome, error: null });
      await expect(
        queue.recalculate(scope.organizationId, workerId, scope),
      ).resolves.toBe(outcome);
    }
    rpc.mockResolvedValueOnce({
      data: "current",
      error: { message: "offline" },
    });
    await expect(
      queue.recalculate(scope.organizationId, workerId, scope),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("keeps failure reporting scoped and accepts an already lost lease", async () => {
    rpc.mockResolvedValueOnce({ data: "lease_lost", error: null });
    await expect(
      queue.fail(scope.organizationId, workerId, scope, "worker_restart"),
    ).resolves.toBeUndefined();
    rpc.mockResolvedValueOnce({ data: "retry", error: { message: "offline" } });
    await expect(
      queue.fail(scope.organizationId, workerId, scope, "worker_restart"),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      queue.fail(
        "00000000-0000-4000-8000-000000000099",
        workerId,
        scope,
        "worker_restart",
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});
