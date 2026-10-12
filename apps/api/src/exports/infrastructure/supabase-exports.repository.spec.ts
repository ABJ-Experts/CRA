import { createExportJobSchema } from "@repo/contracts/exports";
import { SupabaseExportsRepository } from "./supabase-exports.repository";
import {
  ExportAccessDeniedError,
  ExportInvalidRequestError,
  ExportConflictError,
  ExportUnavailableError,
} from "../domain/export.errors";
import type { SupabaseService } from "../../supabase/supabase.service";
const principal = {
  organizationId: "5bb39a5a-7505-4c98-9e62-387824c4c069",
  actorId: "e5a9a4ae-922a-4b45-b976-ea1c0a68a45d",
  sessionId: "6a2430e2-7fe6-4944-862b-dd1ed328633f",
  role: "owner" as const,
};
describe("SupabaseExportsRepository", () => {
  let rpc: jest.Mock;
  let repository: SupabaseExportsRepository;
  beforeEach(() => {
    rpc = jest.fn();
    repository = new SupabaseExportsRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
  });
  it("scopes every status RPC by organization actor and session", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(
      repository.get(principal.organizationId, principal, "job"),
    ).rejects.toThrow(ExportAccessDeniedError);
    expect(rpc).toHaveBeenCalledWith("m14_03_get_export", {
      p_organization_id: principal.organizationId,
      p_actor_user_id: principal.actorId,
      p_session_id: principal.sessionId,
      p_job_id: "job",
    });
  });
  it.each(["40001", "23505"])(
    "maps %s to optimistic conflict",
    async (code) => {
      rpc.mockResolvedValue({ error: { code } });
      await expect(
        repository.mutate(
          principal.organizationId,
          principal,
          "job",
          2,
          "key",
          "cancel",
        ),
      ).rejects.toThrow(ExportConflictError);
    },
  );
  it("maps provider failures to unavailable", async () => {
    rpc.mockRejectedValue(new Error("network"));
    await expect(
      repository.get(principal.organizationId, principal, "job"),
    ).rejects.toThrow(ExportUnavailableError);
  });
  it("rejects malformed successful provider results", async () => {
    rpc.mockResolvedValue({ data: { secret: "not-a-job" }, error: null });
    await expect(
      repository.get(principal.organizationId, principal, "job"),
    ).rejects.toThrow(ExportUnavailableError);
  });
});

describe("export repository request contracts", () => {
  const now = "2026-10-09T00:00:00Z";
  const job = {
    id: "99514f0e-2ce0-456c-92d7-f0229dfd6e47",
    source: "products.registry",
    kind: "list",
    format: "csv",
    state: "queued",
    version: 1,
    requestedAt: now,
    snapshotAsOf: null,
    rowCount: null,
    progress: { processedRows: 0, totalRows: null },
    artifacts: [],
    expiresAt: null,
    failure: null,
    manifest: null,
  };
  const rpc = jest.fn<
    Promise<{ data: unknown; error: { code: string } | null }>,
    [string, Record<string, unknown>]
  >();
  const repo = new SupabaseExportsRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: job, error: null });
  });
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
    expect(await repo.get(principal.organizationId, principal, job.id)).toEqual(
      expect.objectContaining({ manifest }),
    );
    rpc.mockResolvedValue({ data: manifest, error: null });
    expect(
      await repo.manifest(principal.organizationId, principal, job.id),
    ).toEqual(manifest);
    expect(rpc).toHaveBeenLastCalledWith(
      "m14_03_get_export_manifest",
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
    await expect(
      repo.get(principal.organizationId, principal, job.id),
    ).rejects.toThrow(ExportUnavailableError);
  });
  it("creates with only parsed source input", async () => {
    const input = createExportJobSchema.parse({
      source: "products.registry",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: job.id,
    });
    expect(
      await repo.create(principal.organizationId, principal, input),
    ).toEqual(job);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_organization_id: principal.organizationId,
      p_input: input,
    });
  });
  it("passes readiness product context", async () => {
    expect(
      await repo.createReadiness(principal.organizationId, principal, {
        productId: job.id,
        idempotencyKey: job.id,
      }),
    ).toEqual(job);
    expect(rpc.mock.calls[0]?.[0]).toBe("m14_03_create_readiness_export");
  });
  it("parses scoped job lists", async () => {
    rpc.mockResolvedValue({
      data: { data: [job], nextCursor: null },
      error: null,
    });
    expect(
      await repo.list(principal.organizationId, principal, { limit: 25 }),
    ).toEqual({ data: [job], nextCursor: null });
  });
  it("persists only the opaque grant digest", async () => {
    const grant = {
      grantId: job.id,
      expiresAt: now,
      downloadPath: `/api/v1/exports/${job.id}/download/${job.id}`,
    };
    rpc.mockResolvedValue({ data: grant, error: null });
    expect(
      await repo.grant(
        principal.organizationId,
        principal,
        job.id,
        job.id,
        "a".repeat(64),
      ),
    ).toEqual(grant);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_artifact_id: job.id,
      p_token_digest: "a".repeat(64),
    });
  });
  it("rejects a mismatched tenant before database access", () => {
    expect(() => repo.get(job.id, principal, job.id)).toThrow(
      ExportAccessDeniedError,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["22023", ExportInvalidRequestError],
    ["unknown", ExportUnavailableError],
  ])("maps classified SQL errors %s", async (code, ErrorType) => {
    rpc.mockResolvedValue({ error: { code }, data: null });
    await expect(
      repo.get(principal.organizationId, principal, job.id),
    ).rejects.toThrow(ErrorType);
  });
});
