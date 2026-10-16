import {
  auditDownloadGrantSchema,
  auditExportJobSchema,
  auditPageSchema,
  auditSnapshotSchema,
} from "@repo/contracts/audit/schemas";
import { describe, expect, it, vi } from "vitest";

import { AuditGateway } from "./audit.api";

const requestId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const from = "2026-01-01T00:00:00Z";
const to = "2026-01-31T00:00:00Z";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AuditGateway", () => {
  it("parses search input and response through the shared schemas", async () => {
    const snapshot = auditSnapshotSchema.parse({
      snapshotToken: "snapshot_1",
      expiresAt: to,
      filters: { from, to },
    });
    const fetcher = vi.fn(async () => json(snapshot));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      new AuditGateway().search({
        requestId,
        filters: { from, to },
      }),
    ).resolves.toEqual(snapshot);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/audit/searches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ requestId, filters: { from, to } }),
      }),
    );
  });

  it("keeps GET page request identities in the query string", async () => {
    const page = auditPageSchema.parse({ items: [], nextCursor: null });
    const fetcher = vi.fn(async () => json(page));
    vi.stubGlobal("fetch", fetcher);

    await new AuditGateway().page("snapshot_1", {
      requestId,
      cursor: "cursor_1",
      limit: 25,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/audit/searches/snapshot_1/events?requestId=00000000-0000-4000-8000-000000000001&limit=25&cursor=cursor_1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("requests details, exports, status, and same-origin grants on scoped paths", async () => {
    const job = auditExportJobSchema.parse({
      id: jobId,
      status: "ready",
      format: "csv",
      createdAt: from,
      expiresAt: to,
      rowCount: 1,
      packageHash: "a".repeat(64),
      failureCode: null,
    });
    const grant = auditDownloadGrantSchema.parse({
      url: `/api/v1/audit/exports/${jobId}/download`,
      expiresAt: to,
      packageHash: "a".repeat(64),
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ event: {
        id: eventId,
        sequence: "1",
        legacy: false,
        createdAt: from,
        actor: { id: eventId, type: "user", label: null },
        action: "product.updated",
        resourceType: "product",
        resourceId: eventId,
        correlationId: null,
        outcome: "completed",
        verificationStatus: "not_verified",
      }, before: null, after: null, reason: null }))
      .mockResolvedValueOnce(json(job))
      .mockResolvedValueOnce(json(job))
      .mockResolvedValueOnce(json(grant));
    vi.stubGlobal("fetch", fetcher);
    const gateway = new AuditGateway();

    await gateway.detail("snapshot_1", eventId, requestId);
    await gateway.createExport({
      requestId,
      snapshotToken: "snapshot_1",
      format: "csv",
    });
    await gateway.exportJob(jobId, requestId);
    await gateway.grantDownload(jobId, { requestId });

    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/audit/searches/snapshot_1/events/${eventId}?requestId=${requestId}`,
      "/api/v1/audit/exports",
      `/api/v1/audit/exports/${jobId}?requestId=${requestId}`,
      `/api/v1/audit/exports/${jobId}/download-grants`,
    ]);
    expect(fetcher.mock.calls[3]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ requestId }),
      }),
    );
  });

  it("does not refresh or replay POST audit mutations after authorization failure", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          statusCode: 401,
          message: "Expired",
        }),
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      new AuditGateway().createExport({
        requestId,
        snapshotToken: "snapshot_1",
        format: "csv",
      }),
    ).rejects.toMatchObject({ kind: "api", status: 401 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/audit/exports",
      expect.objectContaining({ method: "POST" }),
    );
    const requestedPaths = fetcher.mock.calls.map(
      (call) => call.at(0) as unknown,
    );
    expect(requestedPaths).not.toContain("/api/v1/auth/refresh");
  });
});
