import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditSiemGateway } from "./siem.api";
import { authenticatedRequestJson } from "../../../_lib/http/authenticated-request";
vi.mock("../../../_lib/http/authenticated-request", () => ({
  authenticatedRequestJson: vi.fn(),
}));
const id = "11111111-1111-4111-8111-111111111111";
describe("AuditSiemGateway", () => {
  beforeEach(() => vi.clearAllMocks());
  it("parses destinations and delivers bounded request identity", async () => {
    await new AuditSiemGateway().list(id);
    expect(authenticatedRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/audit/siem/destinations?requestId=${id}`,
        schema: expect.anything(),
      }),
    );
  });
  it("rejects invalid path identity before transport", () =>
    expect(() => new AuditSiemGateway().get("wrong", id)).toThrow());
  it("uses explicit schemas for credentials with no automatic POST replay", async () => {
    await new AuditSiemGateway().credential(id, {
      requestId: id,
      expectedVersion: 1,
      credential: { mode: "bearer", token: "secret" },
    });
    expect(authenticatedRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        inputSchema: expect.anything(),
        schema: expect.anything(),
        path: `/api/v1/audit/siem/destinations/${id}/credentials`,
      }),
    );
  });
});
it("covers all validated public operations", async () => {
  vi.clearAllMocks();
  const api = new AuditSiemGateway(),
    config = {
      name: "Collector",
      transport: "https" as const,
      format: "json" as const,
      endpoint: "https://collector.example.com/events",
      eventClasses: ["access_control" as const],
      productIds: [],
    },
    operation = { requestId: id, expectedVersion: 1 };
  await api.catalogue(id);
  await api.get(id, id);
  await api.create({ ...config, requestId: id, destinationId: id });
  await api.update(id, {
    ...config,
    ...operation,
    backlogPolicy: "cancel_pending_start_future",
    reason: "Change recipient",
  });
  await api.operation(id, "enable", operation);
  await api.operation(id, "disable", operation);
  await api.operation(id, "credentials/revoke", operation);
  await api.test(id, operation);
  await api.deliveries(id, { requestId: id, limit: 50 });
  await api.deliveries(id, { requestId: id, limit: 50, cursor: "opaque" });
  await api.detail(id, id, id);
  await api.preview(id, id, operation);
  await api.replay(id, id, {
    ...operation,
    previewDigest: "a".repeat(64),
    reason: "Reviewed source",
    confirmRecipient: true,
  });
  expect(authenticatedRequestJson).toHaveBeenCalledTimes(13);
});
