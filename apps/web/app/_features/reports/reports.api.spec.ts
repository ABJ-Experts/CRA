import { describe, expect, it, vi } from "vitest";
import { ReportsGateway } from "./reports.api";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

describe("ReportsGateway", () => {
  it("validates each JSON boundary and encodes scoped paths", async () => {
    const client = { request: vi.fn().mockResolvedValue({}) };
    const gateway = new ReportsGateway(client);
    await gateway.list({ limit: 25 });
    await gateway.get(id);
    await gateway.runs({ definitionId: id });
    await gateway.run(otherId);
    await gateway.recipients({ limit: 25 });
    await gateway.emailPreference();
    await gateway.manifest(otherId, id);
    await gateway.grant(otherId, id, id);
    expect(client.request.mock.calls.map(([options]) => options.path)).toEqual([
      "/api/v1/reports/definitions?limit=25",
      `/api/v1/reports/definitions/${id}`,
      `/api/v1/reports/runs?limit=25&definitionId=${id}`,
      `/api/v1/reports/runs/${otherId}`,
      "/api/v1/reports/recipients?limit=25",
      "/api/v1/reports/email-preference",
      `/api/v1/reports/runs/${otherId}/recipients/${id}/manifest`,
      `/api/v1/reports/runs/${otherId}/recipients/${id}/download-grants`,
    ]);
    for (const [options] of client.request.mock.calls) {
      expect(options.schema).toBeDefined();
      if (options.body) {
        expect(options.inputSchema.safeParse(options.body).success).toBe(true);
      }
    }
    expect(() => gateway.get("../other")).toThrow();
    expect(() => gateway.run("../other")).toThrow();
  });

  it("sends explicit command versions and idempotency keys without automatic replay", async () => {
    const client = { request: vi.fn().mockResolvedValue({}) };
    const gateway = new ReportsGateway(client);
    await gateway.preview(id, { expectedVersion: 2, idempotencyKey: otherId });
    await gateway.activate(id, {
      expectedVersion: 2,
      idempotencyKey: otherId,
      previewRunId: id,
    });
    await gateway.pause(id, { expectedVersion: 3, idempotencyKey: otherId });
    await gateway.resume(id, {
      expectedVersion: 4,
      idempotencyKey: otherId,
      previewRunId: id,
    });
    await gateway.archive(id, { expectedVersion: 5, idempotencyKey: otherId });
    await gateway.replay(otherId, { expectedVersion: 2, idempotencyKey: id });
    expect(
      client.request.mock.calls.map(([options]) => [
        options.method,
        options.path,
      ]),
    ).toEqual([
      ["POST", `/api/v1/reports/definitions/${id}/preview`],
      ["POST", `/api/v1/reports/definitions/${id}/activate`],
      ["POST", `/api/v1/reports/definitions/${id}/pause`],
      ["POST", `/api/v1/reports/definitions/${id}/resume`],
      ["POST", `/api/v1/reports/definitions/${id}/archive`],
      ["POST", `/api/v1/reports/runs/${otherId}/replay`],
    ]);
    expect(
      client.request.mock.calls.every(
        ([options]) => options.inputSchema.safeParse(options.body).success,
      ),
    ).toBe(true);
  });

  it("keeps administrator operations on metadata-only report routes", async () => {
    const client = { request: vi.fn().mockResolvedValue({}) };
    const gateway = new ReportsGateway(client);
    await gateway.administration({ limit: 25 });
    await gateway.administrationPause(id, {
      expectedVersion: 2,
      idempotencyKey: otherId,
    });
    expect(client.request.mock.calls.map(([options]) => options.path)).toEqual([
      "/api/v1/reports/administration?limit=25",
      `/api/v1/reports/administration/${id}/pause`,
    ]);
    const schema = client.request.mock.calls[0]![0].schema;
    expect(
      schema.safeParse({
        items: [
          { id, ownerUserId: otherId, state: "active", version: 1, config: {} },
        ],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});
