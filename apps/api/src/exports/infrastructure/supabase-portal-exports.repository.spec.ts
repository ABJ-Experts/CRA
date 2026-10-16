import { createExportJobSchema } from "@repo/contracts/exports";
import { SupabasePortalExportsRepository } from "./supabase-portal-exports.repository";
import {
  ExportAccessDeniedError,
  ExportConflictError,
  ExportInvalidRequestError,
  ExportUnavailableError,
} from "../domain/export.errors";
import type { SupabaseService } from "../../supabase/supabase.service";
const id = "99514f0e-2ce0-456c-92d7-f0229dfd6e47";
const p = { kind: "supplier_session" as const, sessionDigest: "a".repeat(64) };
const job = {
  id,
  source: "supplier_evidence.portal_items",
  kind: "list",
  format: "csv",
  state: "queued",
  version: 1,
  requestedAt: "2026-10-09T00:00:00Z",
  snapshotAsOf: null,
  rowCount: null,
  progress: { processedRows: 0, totalRows: null },
  artifacts: [],
  expiresAt: null,
  failure: null,
  manifest: null,
};
describe("portal export repository", () => {
  const rpc = jest.fn<
    Promise<{ data: unknown; error: { code?: string } | null }>,
    [string, Record<string, unknown>]
  >();
  const repo = new SupabasePortalExportsRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);
  beforeEach(() =>
    rpc.mockReset().mockResolvedValue({ data: job, error: null }),
  );
  it("returns a parsed delivery manifest without private storage paths", async () => {
    const artifact = {
      id: job.id,
      name: "part-0001.csv",
      mediaType: "text/csv",
      byteLength: 12,
      sha256: "a".repeat(64),
      rowCount: 0,
    };
    const manifest = {
      version: "m14_03_v1",
      jobId: job.id,
      source: job.source,
      requestedAt: job.requestedAt,
      snapshotAsOf: job.requestedAt,
      scope: "all_filtered",
      requestDigest: "a".repeat(64),
      rowCount: 0,
      columns: [],
      artifacts: [artifact],
      sourceVersionsDigest: "b".repeat(64),
      documentationReadinessOnly: false,
    };
    rpc.mockResolvedValue({
      data: {
        ...job,
        state: "ready",
        snapshotAsOf: job.requestedAt,
        rowCount: 0,
        progress: { processedRows: 0, totalRows: 0 },
        artifacts: [artifact],
        manifest,
      },
      error: null,
    });
    expect(await repo.get(p, id)).toEqual(
      expect.objectContaining({ manifest }),
    );
    rpc.mockResolvedValue({ data: manifest, error: null });
    expect(await repo.manifest(p, id)).toEqual(manifest);
    expect(rpc).toHaveBeenLastCalledWith(
      "m14_03_get_portal_export_manifest",
      expect.objectContaining({ p_job_id: job.id }),
    );
    rpc.mockResolvedValue({
      data: {
        ...job,
        state: "ready",
        snapshotAsOf: job.requestedAt,
        rowCount: 0,
        progress: { processedRows: 0, totalRows: 0 },
        artifacts: [artifact],
        manifest: {
          ...manifest,
          artifacts: [{ ...artifact, objectPath: "private/file" }],
        },
      },
      error: null,
    });
    await expect(repo.get(p, id)).rejects.toThrow(ExportUnavailableError);
  });
  it("scopes create to original session hash without browser tenant", async () => {
    const input = createExportJobSchema.parse({
      source: "supplier_evidence.portal_items",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: id,
    });
    expect(await repo.create(p, input)).toEqual(job);
    expect(rpc).toHaveBeenCalledWith("m14_03_create_portal_export", {
      p_subject_kind: p.kind,
      p_session_digest: p.sessionDigest,
      p_input: input,
    });
  });
  it("parses own job status", async () =>
    expect(await repo.get(p, id)).toEqual(job));
  it("parses own lists", async () => {
    rpc.mockResolvedValue({
      data: { data: [job], nextCursor: null },
      error: null,
    });
    expect(await repo.list(p, { limit: 25 })).toEqual({
      data: [job],
      nextCursor: null,
    });
  });
  it("binds idempotency and version for retries", async () => {
    expect(await repo.mutate(p, id, 1, id, "retry")).toEqual(job);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_expected_version: 1,
      p_idempotency_key: id,
      p_operation: "retry",
    });
  });
  it("issues private session-bound grants", async () => {
    const grant = {
      grantId: id,
      expiresAt: "2026-10-09T00:05:00Z",
      downloadPath: `/api/v1/supplier-evidence-portal/exports/${id}/download/${id}`,
    };
    rpc.mockResolvedValue({ data: grant, error: null });
    expect(await repo.grant(p, id, id, "b".repeat(64))).toEqual(grant);
  });
  it.each([
    ["42501", ExportAccessDeniedError],
    ["P0002", ExportAccessDeniedError],
    ["40001", ExportConflictError],
    ["23505", ExportConflictError],
    ["P0001", ExportConflictError],
    ["22023", ExportInvalidRequestError],
    ["500", ExportUnavailableError],
    [undefined, ExportUnavailableError],
  ])("maps error %s safely", async (code, ErrorType) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code },
    });
    await expect(repo.get(p, id)).rejects.toThrow(ErrorType);
  });
  it("maps network failure safely", async () => {
    rpc.mockRejectedValue(new Error("private"));
    await expect(repo.get(p, id)).rejects.toThrow(ExportUnavailableError);
  });
  it("rejects malformed success", async () => {
    rpc.mockResolvedValue({ data: { unknown: true }, error: null });
    await expect(repo.get(p, id)).rejects.toThrow(ExportUnavailableError);
  });
  it("requires trusted organization in binary redemption", async () => {
    rpc.mockResolvedValue({
      data: { artifact: { objectPath: "private" } },
      error: null,
    });
    await expect(repo.download(p, id, id, "b".repeat(64))).rejects.toThrow(
      ExportUnavailableError,
    );
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_job_id: id,
      p_grant_id: id,
      p_token_digest: "b".repeat(64),
    });
  });
});
