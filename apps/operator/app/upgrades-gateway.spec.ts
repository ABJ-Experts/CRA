import { describe, it, expect, vi } from "vitest";
import { UpgradesGateway } from "./upgrades-gateway";
const instanceId = "00000000-0000-4000-8000-000000000001";
describe("upgrade gateway", () => {
  it("rejects arbitrary media paths before sending", async () => {
    const fetcher = vi.fn();
    await expect(
      new UpgradesGateway(fetcher).stage(instanceId, {
        mediaId: "/tmp/release",
        expectedVersion: 0,
        idempotencyKey: instanceId,
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not replay failed mutations", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(
      new UpgradesGateway(fetcher).stage(instanceId, {
        mediaId: instanceId,
        expectedVersion: 0,
        idempotencyKey: instanceId,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(
      new UpgradesGateway(fetcher).capabilities(instanceId),
    ).rejects.toThrow();
  });
});
import * as schemas from "@repo/contracts/upgrades/schemas";
const run = {
  id: instanceId,
  instanceId,
  mediaId: instanceId,
  version: 1,
  state: "verifying",
  releaseId: null,
  fromVersion: null,
  toVersion: null,
  manifestDigest: null,
  verified: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  completedAt: null,
  failureCode: null,
  preflight: null,
  result: null,
};
const review = {
  runId: instanceId,
  version: 1,
  fingerprint: "a".repeat(64),
  checkedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2027-01-01T00:00:00Z",
  eligible: true,
  summary: {
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    manifestDigest: "a".repeat(64),
    expectedOutageSeconds: 60,
    licenseEffects: ["unchanged"],
    rollback: "compatible-images-before-exposure",
    dataRestored: false,
    migrationsReversed: false,
  },
  checks: [{ code: "backup", status: "passed", detail: "verified" }],
};
const result = {
  instanceId,
  fromVersion: null,
  toVersion: null,
  manifestDigest: null,
  startedAt: "2026-01-01T00:00:00Z",
  checkedAt: null,
  checks: [],
  safeRemediation: ["unavailable"],
  imageDigests: [],
  runId: instanceId,
  outcome: "failed",
  completedAt: "2026-01-01T00:00:00Z",
  failureCode: "unavailable",
  maintenanceRetained: true,
  exposurePossible: false,
  dataRestored: false,
  migrationsReversed: false,
  evidenceId: instanceId,
};
const mutation = { expectedVersion: 1, idempotencyKey: instanceId };
it("parses every control response and propagates cancellation", async () => {
  const fetcher = vi.fn();
  const gateway = new UpgradesGateway(fetcher);
  const respond = (value: unknown) =>
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => value });
  respond({ items: [] });
  await gateway.media(instanceId);
  respond({ items: [run], nextCursor: null });
  await gateway.history(instanceId);
  respond(run);
  await gateway.detail(instanceId, instanceId);
  respond(run);
  await gateway.stage(instanceId, { ...mutation, mediaId: instanceId });
  respond(review);
  await gateway.preflight(instanceId, instanceId, mutation);
  respond(run);
  await gateway.apply(instanceId, instanceId, {
    ...mutation,
    fingerprint: review.fingerprint,
    acknowledgedEffects: true,
  });
  respond(run);
  await gateway.rollback(instanceId, instanceId, mutation);
  respond(run);
  await gateway.reconcile(instanceId, instanceId, mutation);
  respond(result);
  await gateway.result(instanceId, instanceId);
  expect(fetcher).toHaveBeenCalledTimes(9);
  expect(schemas.upgradeRunSchema.parse(run)).toBeTruthy();
});
it("rejects instance and run mismatches", async () => {
  const other = "00000000-0000-4000-8000-000000000002";
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ...run, instanceId: other }),
  });
  const gateway = new UpgradesGateway(fetcher);
  await expect(gateway.detail(instanceId, instanceId)).rejects.toThrow();
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => ({ ...run, id: other }),
  });
  await expect(gateway.detail(instanceId, instanceId)).rejects.toThrow();
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => ({
      items: [{ ...run, instanceId: other }],
      nextCursor: null,
    }),
  });
  await expect(gateway.history(instanceId)).rejects.toThrow();
});
it("validates bounded history cursor query before requesting a page", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [], nextCursor: null }),
  });
  const gateway = new UpgradesGateway(fetcher);
  await gateway.history(instanceId, undefined, {
    cursor: instanceId,
    limit: 25,
  });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `/api/v1/operator/instances/${instanceId}/upgrades/history?limit=25&cursor=${instanceId}`,
  );
  await expect(
    gateway.history(instanceId, undefined, {
      cursor: "arbitrary-path",
      limit: 101,
    }),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
