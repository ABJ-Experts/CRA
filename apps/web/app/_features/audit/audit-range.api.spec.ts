import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditRangeGateway } from "./audit-range.api";
const id = "00000000-0000-4000-8000-000000000001";
const job = {
  id,
  status: "queued",
  version: 0,
  createdAt: "2026-10-07T00:00:00Z",
  updatedAt: "2026-10-07T00:00:00Z",
  result: null,
  failureCode: null,
};
afterEach(() => vi.unstubAllGlobals());
describe("AuditRangeGateway", () => {
  it("parses all four boundaries and retains operation identities", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(job), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const gateway = new AuditRangeGateway();
    await gateway.create({ requestId: id, fromSequence: "1" });
    await gateway.status(id, id);
    await gateway.operation(id, "cancel", {
      requestId: id,
      expectedVersion: 0,
    });
    await gateway.operation(id, "resume", {
      requestId: id,
      expectedVersion: 0,
    });
    expect(fetcher.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      "/api/v1/audit/chain-verifications",
      `/api/v1/audit/chain-verifications/${id}?requestId=${id}`,
      `/api/v1/audit/chain-verifications/${id}/cancel`,
      `/api/v1/audit/chain-verifications/${id}/resume`,
    ]);
  });
  it("rejects invalid paths and malformed successful responses", async () => {
    const gateway = new AuditRangeGateway();
    expect(() => gateway.status("../other", id)).toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      gateway.create({ requestId: id, fromSequence: "1" }),
    ).rejects.toThrow();
  });
  it("does not automatically replay a POST after 401", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new AuditRangeGateway().create({ requestId: id, fromSequence: "1" }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
