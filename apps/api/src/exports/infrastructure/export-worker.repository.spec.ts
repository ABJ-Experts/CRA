import {
  SupabaseExportWorkerRepository,
  parseJob,
} from "./export-worker.repository";
import type { SupabaseService } from "../../supabase/supabase.service";
const id = "8cc33f37-0297-4327-aa68-8a11c557fe7a";
const publicJob = {
  id,
  source: "products.registry",
  kind: "list",
  format: "csv",
  state: "rendering",
  version: 1,
  requestedAt: "2026-10-09T00:00:00Z",
  snapshotAsOf: "2026-10-09T00:00:00Z",
  rowCount: 0,
  progress: { processedRows: 0, totalRows: 0 },
  artifacts: [],
  expiresAt: null,
  failure: null,
};
const privateJob = {
  publicJob,
  organizationId: id,
  source: "products.registry",
  format: "csv",
  scope: "all_filtered",
  columns: ["id", "name"],
  requestDigest: "a".repeat(64),
  snapshotAsOf: publicJob.snapshotAsOf,
  totalRows: 0,
  parts: [],
  workerId: "worker",
  version: 1,
};
describe("export worker database boundary", () => {
  it("parses source-owned columns and rejects fabricated columns", () => {
    expect(parseJob(privateJob).columns.map((column) => column.key)).toEqual([
      "id",
      "name",
    ]);
    expect(() => parseJob({ ...privateJob, columns: ["secret"] })).toThrow(
      "malformed_provider",
    );
    expect(
      parseJob({
        ...privateJob,
        publicJob: { ...publicJob, state: "audit_pending" },
      }).captureState,
    ).toBe("captured");
    expect(
      parseJob({
        ...privateJob,
        publicJob: { ...publicJob, state: "capturing" },
      }).captureState,
    ).toBe("pending");
  });
  it("fences all scoped calls and parses provider responses", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: privateJob, error: null });
    const repository = new SupabaseExportWorkerRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    const job = (await repository.claim("worker"))!;
    await repository.capture(job);
    await repository.publishCapture(job);
    await repository.heartbeat(job);
    await repository.checkpoint(job, []);
    await repository.complete(job, {});
    await repository.fail(job, "access_changed");
    expect(rpc).toHaveBeenCalledWith(
      "m14_03_checkpoint_export",
      expect.objectContaining({
        p_organization_id: id,
        p_job_id: id,
        p_worker_id: "worker",
        p_expected_version: 1,
        p_processed_rows: 0,
      }),
    );
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await repository.authorize(job)).toBe(true);
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await repository.rows(job, 0, 250)).toEqual([]);
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await repository.claim("worker")).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "secret" } });
    await expect(repository.capture(job)).rejects.toThrow(
      "provider_unavailable",
    );
  });
});
it.each([
  ["54000", "export_limit"],
  ["42501", "access_changed"],
  ["57014", "capture_timeout"],
  ["40001", "lease_conflict"],
  ["08006", "provider_unavailable"],
])("preserves safe PostgreSQL failure class %s", async (code, expected) => {
  const repository = new SupabaseExportWorkerRepository({
    admin: () => ({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { code, message: "sensitive database detail" },
      }),
    }),
  } as unknown as SupabaseService);
  await expect(repository.capture(parseJob(privateJob))).rejects.toThrow(
    expected,
  );
});
