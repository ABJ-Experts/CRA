import { describe, expect, it, vi } from "vitest";
import { ExportsGateway } from "./exports.api";
import { ApiClient } from "../../_lib/http/api-client";
import { AuthenticatedApiClient } from "../../_lib/http/authenticated-request";
const id = "00000000-0000-4000-8000-000000000001";
const job = {
  id,
  source: "products.registry",
  kind: "list",
  format: "csv",
  state: "queued",
  version: 1,
  requestedAt: "2026-10-09T12:00:00.000Z",
  snapshotAsOf: null,
  rowCount: null,
  progress: { processedRows: 0, totalRows: null },
  artifacts: [],
  expiresAt: null,
  failure: null,
};
const request = {
  source: "products.registry" as const,
  context: {},
  filters: { page: 1, pageSize: 25 },
  scope: "all_filtered" as const,
  format: "csv" as const,
  idempotencyKey: id,
};
describe("ExportsGateway", () => {
  it("delivers manifests through the fresh scoped endpoint with a strict response contract", async () => {
    for (const basePath of [
      "/api/v1/exports",
      "/api/v1/auditor/exports",
      "/api/v1/supplier-evidence-portal/exports",
    ] as const) {
      const client = { request: vi.fn().mockResolvedValue({ data: {} }) };
      const gateway = new ExportsGateway(client, { basePath });
      const signal = new AbortController().signal;
      await gateway.manifest(id, signal);
      const options = client.request.mock.calls[0]?.[0];
      expect(options.path).toBe(`${basePath}/${id}/manifest`);
      expect(options.signal).toBe(signal);
      expect(
        options.schema.safeParse({ data: { objectPath: "secret" } }).success,
      ).toBe(false);
      expect(() => gateway.manifest("../forged")).toThrow();
      expect(client.request).toHaveBeenCalledOnce();
    }
  });
  it("provides runtime schemas for every consumed JSON request and response", async () => {
    const client = { request: vi.fn().mockResolvedValue({ data: job }) };
    const gateway = new ExportsGateway(client);
    await gateway.create(request);
    await gateway.get(id);
    await gateway.list();
    await gateway.cancel(id, 1);
    await gateway.retry(id, 1);
    await gateway.grant(id, id);
    await gateway.createReadiness({ productId: id, idempotencyKey: id });
    for (const [options] of client.request.mock.calls) {
      expect(options.schema).toBeDefined();
      if (options.method === "POST") {
        expect(options.inputSchema).toBeDefined();
        expect(options.inputSchema.safeParse(options.body).success).toBe(true);
      }
    }
    expect(client.request.mock.calls[6]?.[0].path).toBe(
      `/api/v1/products/${id}/audit-readiness/exports`,
    );
  });
  it("rejects forged paths before transport", () => {
    const client = { request: vi.fn() };
    const gateway = new ExportsGateway(client);
    expect(() => gateway.get("../../other-tenant")).toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });
  it("validates successful server payloads", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ...job, rowCount: -1 } }), {
        status: 200,
      }),
    );
    const client = new ApiClient();
    const gateway = new ExportsGateway({
      request: (options) => client.request({ ...options, fetcher }),
    });
    await expect(gateway.create(request)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
  it("does not refresh or replay a creation POST after 401", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      }),
    );
    const client = new AuthenticatedApiClient(new ApiClient());
    const gateway = new ExportsGateway({
      request: (options) => client.request({ ...options, fetcher }),
    });
    await expect(gateway.create(request)).rejects.toMatchObject({
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
