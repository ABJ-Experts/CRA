import { createHash } from "node:crypto";
import { SupabaseExportsRepository } from "./supabase-exports.repository";
import {
  ExportAccessDeniedError,
  ExportUnavailableError,
} from "../domain/export.errors";
import type { SupabaseService } from "../../supabase/supabase.service";
const orgId = "5bb39a5a-7505-4c98-9e62-387824c4c069",
  jobId = "99514f0e-2ce0-456c-92d7-f0229dfd6e47",
  grantId = "22110288-e5ad-4677-b850-a44c07dfd9b5";
const p = {
  organizationId: orgId,
  actorId: "e5a9a4ae-922a-4b45-b976-ea1c0a68a45d",
  sessionId: "6a2430e2-7fe6-4944-862b-dd1ed328633f",
  role: "owner" as const,
};
const content = Buffer.from("id,name\r\n1,café\r\n");
const sha256 = createHash("sha256").update(content).digest("hex");
const artifact = {
  id: grantId,
  name: "part-001.csv",
  mediaType: "text/csv",
  byteLength: content.length,
  sha256,
  objectPath: `${orgId}/${jobId}/part-0001.csv-${sha256}`,
};
const job = {
  id: jobId,
  source: "products.registry",
  kind: "list",
  format: "csv",
  state: "ready",
  version: 2,
  requestedAt: "2026-10-09T00:00:00Z",
  snapshotAsOf: "2026-10-09T00:00:01Z",
  rowCount: 1,
  progress: { processedRows: 1, totalRows: 1 },
  artifacts: [
    {
      id: artifact.id,
      name: artifact.name,
      mediaType: artifact.mediaType,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      rowCount: 1,
    },
  ],
  expiresAt: "2026-10-10T00:00:00Z",
  failure: null,
};
describe("verified export delivery", () => {
  let rpc: jest.Mock;
  let stream: jest.Mock;
  let repo: SupabaseExportsRepository;
  beforeEach(() => {
    rpc = jest.fn().mockImplementation((name: string) =>
      Promise.resolve({
        error: null,
        data: name.includes("redeem") ? { artifact } : job,
      }),
    );
    stream = jest.fn().mockResolvedValue({
      error: null,
      data: new ReadableStream({
        start(c) {
          c.enqueue(content);
          c.close();
        },
      }),
    });
    repo = new SupabaseExportsRepository({
      admin: () => ({
        rpc,
        storage: { from: () => ({ download: () => ({ asStream: stream }) }) },
      }),
    } as unknown as SupabaseService);
  });
  it("verifies exact bytes/hash and streams from private spool", async () => {
    const result = await repo.download(
      orgId,
      p,
      jobId,
      grantId,
      "f".repeat(64),
    );
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of result.body)
        chunks.push(Buffer.from(chunk as Uint8Array));
      expect(Buffer.concat(chunks)).toEqual(content);
      expect(result.sha256).toBe(sha256);
      expect(
        rpc.mock.calls.filter(([name]) => name === "m14_03_get_export").length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      await result.cleanup();
    }
  });
  it("denies a cross-tenant storage path", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: {
        artifact: { ...artifact, objectPath: `${grantId}/${jobId}/part.csv` },
      },
    });
    await expect(
      repo.download(orgId, p, jobId, grantId, "f".repeat(64)),
    ).rejects.toThrow(ExportAccessDeniedError);
    expect(stream).not.toHaveBeenCalled();
  });
  it("fails safely when storage is unavailable", async () => {
    stream.mockResolvedValue({ error: { code: "500" }, data: null });
    await expect(
      repo.download(orgId, p, jobId, grantId, "f".repeat(64)),
    ).rejects.toThrow(ExportUnavailableError);
  });
  it("rejects corrupt bytes before delivery", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        error: null,
        data: name.includes("redeem")
          ? { artifact: { ...artifact, sha256: "a".repeat(64) } }
          : job,
      }),
    );
    await expect(
      repo.download(orgId, p, jobId, grantId, "f".repeat(64)),
    ).rejects.toThrow(ExportUnavailableError);
  });
  it("rejects oversized bytes before delivery", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        error: null,
        data: name.includes("redeem")
          ? { artifact: { ...artifact, byteLength: 1 } }
          : job,
      }),
    );
    await expect(
      repo.download(orgId, p, jobId, grantId, "f".repeat(64)),
    ).rejects.toThrow(ExportUnavailableError);
  });
  it("reauthorizes after slow storage before exposing stream", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name.includes("redeem")
          ? { error: null, data: { artifact } }
          : { error: { code: "42501" }, data: null },
      ),
    );
    await expect(
      repo.download(orgId, p, jobId, grantId, "f".repeat(64)),
    ).rejects.toThrow(ExportAccessDeniedError);
  });
  it("fails safely on unexpected storage exception", async () => {
    stream.mockRejectedValue(new Error("private provider detail"));
    await expect(
      repo.download(orgId, p, jobId, grantId, "f".repeat(64)),
    ).rejects.toThrow(ExportUnavailableError);
  });
});
