import type { SupabaseService } from "../../supabase/supabase.service";
import {
  SupabaseReportsWorkerRepository,
  ScheduledExportWorkerRepository,
} from "./supabase-reports-worker.repository";
import type { ReportRecipientClaim } from "../worker/reports-worker";

const claim = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  recipientId: "22222222-2222-4222-8222-222222222222",
  workerId: "33333333-3333-4333-8333-333333333333",
  version: 2,
} as ReportRecipientClaim;

function subject(data: unknown, error: { code?: string } | null = null) {
  const rpc = jest.fn().mockResolvedValue({ data, error });
  const supabase = { admin: () => ({ rpc }) } as unknown as SupabaseService;
  return {
    repository: new SupabaseReportsWorkerRepository(supabase),
    exportRepository: new ScheduledExportWorkerRepository(supabase),
    rpc,
  };
}

describe("scheduled report worker RPC boundary", () => {
  it("uses bounded scheduler arguments and preserves empty claims", async () => {
    const { repository, rpc } = subject(0);
    await expect(repository.scheduleDue(claim.workerId, 10)).resolves.toBe(0);
    expect(rpc).toHaveBeenCalledWith("m14_04_schedule_due", {
      p_worker_id: claim.workerId,
      p_limit: 10,
    });
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(repository.claimRecipient(claim.workerId)).resolves.toBeNull();
  });
  it("fences publication, admission and failure by tenant, recipient, worker and version", async () => {
    const { repository, rpc } = subject({ outcome: "ready" });
    await repository.admitExport(claim, {
      _sourceSchemaDigest: "a".repeat(64),
    });
    await repository.publishRecipient(claim);
    await repository.failRecipient(claim, "storage_unavailable");
    await expect(repository.heartbeatRecipient(claim)).rejects.toThrow(
      "provider_unavailable",
    );
    for (const [name, args] of rpc.mock.calls as [
      string,
      Record<string, unknown>,
    ][]) {
      expect(name).toMatch(/^m14_04_/);
      expect(args).toMatchObject({
        p_organization_id: claim.organizationId,
        p_recipient_id: claim.recipientId,
        p_worker_id: claim.workerId,
        p_expected_version: claim.version,
      });
    }
  });
  it("maps access and lease loss without inventing authorization", async () => {
    const { repository, rpc } = subject(null, { code: "42501" });
    await expect(repository.authorizeRecipient(claim)).rejects.toThrow(
      "access_changed",
    );
    rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    await expect(repository.publishRecipient(claim)).rejects.toThrow(
      "lease_conflict",
    );
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(repository.claimRecipient(claim.workerId)).rejects.toThrow(
      "capture_timeout",
    );
    rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    await expect(repository.heartbeatRecipient(claim)).rejects.toThrow(
      "lease_conflict",
    );
    await expect(repository.admitExport(claim, {})).rejects.toThrow(
      "lease_conflict",
    );
    await expect(
      repository.failRecipient(claim, "lease_conflict"),
    ).rejects.toThrow("lease_conflict");
  });
  it("claims scheduled exports from their separate quota", async () => {
    const { exportRepository, rpc } = subject(null);
    await expect(exportRepository.claim(claim.workerId)).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("m14_04_claim_export", {
      p_worker_id: claim.workerId,
    });
  });
  it("maps malformed scheduled export claims to a stable provider failure", async () => {
    const { exportRepository } = subject({ publicJob: { id: "invalid" } });
    await expect(exportRepository.claim(claim.workerId)).rejects.toThrow(
      "provider_unavailable",
    );
  });
  it("keeps transport outages separate from lease and access changes", async () => {
    const { repository, exportRepository, rpc } = subject(null);
    rpc.mockRejectedValueOnce(new Error("provider secret"));
    await expect(repository.scheduleDue(claim.workerId, 10)).rejects.toThrow(
      "provider_unavailable",
    );
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P9999" } });
    await expect(repository.claimRecipient(claim.workerId)).rejects.toThrow(
      "provider_unavailable",
    );
    rpc.mockRejectedValueOnce(new Error("provider secret"));
    await expect(exportRepository.claim(claim.workerId)).rejects.toThrow(
      "provider_unavailable",
    );
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40001" } });
    await expect(exportRepository.claim(claim.workerId)).rejects.toThrow(
      "lease_conflict",
    );
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001" } });
    await expect(exportRepository.claim(claim.workerId)).rejects.toThrow(
      "lease_conflict",
    );
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P9999" } });
    await expect(exportRepository.claim(claim.workerId)).rejects.toThrow(
      "provider_unavailable",
    );
  });
  it("parses an admitted scheduled job through the existing export worker contract", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const publicJob = {
      id,
      source: "products.registry",
      kind: "list",
      format: "csv",
      state: "rendering",
      version: 1,
      requestedAt: "2026-10-12T00:00:00Z",
      snapshotAsOf: "2026-10-12T00:00:00Z",
      rowCount: 0,
      progress: { processedRows: 0, totalRows: 0 },
      artifacts: [],
      expiresAt: null,
      failure: null,
    };
    const privateJob = {
      publicJob,
      organizationId: claim.organizationId,
      source: "products.registry",
      format: "csv",
      scope: "all_filtered",
      columns: ["id", "name"],
      requestDigest: "a".repeat(64),
      snapshotAsOf: publicJob.snapshotAsOf,
      totalRows: 0,
      parts: [],
      workerId: claim.workerId,
      version: 1,
    };
    const { exportRepository } = subject(privateJob);
    await expect(exportRepository.claim(claim.workerId)).resolves.toMatchObject(
      { id, organizationId: claim.organizationId },
    );
  });
});
