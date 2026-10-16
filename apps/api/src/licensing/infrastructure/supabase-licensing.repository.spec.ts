import { SupabaseLicensingRepository } from "./supabase-licensing.repository";
import type { SupabaseService } from "../../supabase/supabase.service";
import { createHash } from "node:crypto";
const org = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const rpc = jest.fn();
  const upload = jest.fn().mockResolvedValue({ error: null });
  const download = jest.fn().mockResolvedValue({
    data: { arrayBuffer: () => Promise.resolve(Buffer.from("a.b.c")) },
    error: null,
  });
  const from = jest.fn().mockReturnValue({ upload, download });
  const repository = new SupabaseLicensingRepository({
    admin: () => ({ rpc, storage: { from } }),
  } as unknown as SupabaseService);
  return { repository, rpc, upload, download, from };
}
describe("SupabaseLicensingRepository", () => {
  it("looks up actor and request bound receipts without writing archive bytes", async () => {
    const { repository, rpc, upload } = fixture();
    const request = {
      artifact: "a.b.c",
      digest: "a".repeat(64),
      idempotencyKey: org,
      requestDigest: "b".repeat(64),
    };
    rpc.mockResolvedValue({
      data: { outcome: "replayed", version: 1, licenseId: org },
      error: null,
    });
    await expect(
      repository.activationReceipt(org, "actor", request),
    ).resolves.toMatchObject({ licenseId: org, outcome: "replayed" });
    expect(rpc).toHaveBeenCalledWith("m15_01_activation_receipt", {
      p_organization_id: org,
      p_actor_user_id: "actor",
      p_artifact: request.artifact,
      p_artifact_digest: request.digest,
      p_idempotency_key: org,
      p_request_digest: request.requestDigest,
    });
    expect(upload).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { outcome: "absent" }, error: null });
    await expect(
      repository.activationReceipt(org, "actor", request),
    ).resolves.toEqual({ outcome: "absent" });
    rpc.mockResolvedValue({
      data: { outcome: "replayed", version: 1, licenseId: "malformed" },
      error: null,
    });
    await expect(
      repository.activationReceipt(org, "actor", request),
    ).rejects.toThrow();
  });
  it("scopes state to tenant and actor and parses provider replies", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValue({
      data: {
        state: null,
        usage: {
          activeMembers: 1,
          reservedInvitations: 0,
          products: 2,
          storageBytes: 3,
        },
        storageAccountingReady: true,
      },
      error: null,
    });
    await expect(repository.getState(org, "actor")).resolves.toMatchObject({
      state: null,
    });
    expect(rpc).toHaveBeenCalledWith("m15_01_get_state", {
      p_organization_id: org,
      p_actor_user_id: "actor",
    });
    rpc.mockResolvedValue({ data: { state: null }, error: null });
    await expect(repository.getState(org, "actor")).rejects.toThrow();
  });
  it("does not emit provider errors", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValue({ error: { message: "secret" }, data: null });
    await expect(repository.getState(org, "actor")).rejects.toThrow(
      "Licence authority is unavailable",
    );
  });
  it("archives deterministically and verifies existing bytes on retry", async () => {
    const { repository, upload } = fixture();
    const digest = createHash("sha256").update("a.b.c").digest("hex");
    upload.mockResolvedValue({ error: { status: 409 } });
    await expect(repository.archive(org, digest, "a.b.c")).resolves.toBe(
      `${org}/${digest}.jws`,
    );
    expect(upload).toHaveBeenCalledWith(
      `${org}/${digest}.jws`,
      expect.any(Buffer),
      expect.objectContaining({ upsert: false }),
    );
  });
  it("denies activation if archive verification fails", async () => {
    const { repository, download, rpc } = fixture();
    download.mockResolvedValue({ data: null, error: { message: "private" } });
    await expect(
      repository.archive(org, "a".repeat(64), "a.b.c"),
    ).rejects.toThrow("Licence evidence archive is unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps safe history summaries and validates cursor", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValue({
      data: {
        items: [
          {
            id: org,
            sequence: 1,
            action: "licensing.rejected",
            outcome: "rejected",
            reason: "unknown_key",
            createdAt: "2026-10-13T00:00:00.000Z",
            artifactDigest: null,
            version: 0,
          },
        ],
        nextCursor: null,
      },
      error: null,
    });
    await expect(
      repository.history(org, "actor", { limit: 20 }),
    ).resolves.toMatchObject({
      items: [{ action: "rejected", reason: "unknown_key" }],
    });
    await expect(
      repository.history(org, "actor", { limit: 20, cursor: "1;bad" }),
    ).rejects.toThrow("Licence history cursor is invalid");
  });
  it("passes rejected audit attempt without storing invalid bytes", async () => {
    const { repository, rpc, upload } = fixture();
    rpc.mockResolvedValue({
      data: { outcome: "rejected", version: 1 },
      error: null,
    });
    await expect(
      repository.activate(org, "actor", {
        artifact: "a.b.c",
        digest: "a".repeat(64),
        claims: null,
        expectedVersion: 1,
        idempotencyKey: org,
        requestDigest: "b".repeat(64),
        rejectionReason: "wrong_binding",
      }),
    ).resolves.toMatchObject({ outcome: "rejected" });
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "m15_01_activate",
      expect.objectContaining({
        p_artifact_object_path: null,
        p_rejection_reason: "wrong_binding",
      }),
    );
  });
  it("persists observation with no tenant inference", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValue({
      data: { timeHighWaterAt: null, clockRollbackDetected: false },
      error: null,
    });
    await repository.checkpoint(org, "actor", "2026-10-13T00:00:00.000Z");
    expect(rpc).toHaveBeenCalledWith("m15_01_checkpoint_time", {
      p_organization_id: org,
      p_actor_user_id: "actor",
      p_observed_at: "2026-10-13T00:00:00.000Z",
    });
  });

  it("uses only service worker state authority and checkpoint", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValueOnce({
      data: {
        state: null,
        usage: {
          activeMembers: 1,
          reservedInvitations: 0,
          products: 2,
          storageBytes: 3,
        },
        storageAccountingReady: true,
      },
      error: null,
    });
    await repository.getWorkerState(org);
    expect(rpc).toHaveBeenCalledWith("m15_01_get_worker_state", {
      p_organization_id: org,
    });
    rpc.mockResolvedValue({
      data: { timeHighWaterAt: null, clockRollbackDetected: false },
      error: null,
    });
    await repository.checkpointWorker(org, "2026-10-13T00:00:00.000Z");
    expect(rpc).toHaveBeenCalledWith(
      "m15_01_checkpoint_worker_time",
      expect.objectContaining({ p_organization_id: org }),
    );
  });
  it("publishes bounded proof and parses worker candidate tenants", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValueOnce({ data: [org], error: null });
    await expect(
      repository.listWorkerCandidateOrganizations(
        "products",
        100,
        1,
        "b".repeat(64),
      ),
    ).resolves.toEqual([org]);
    rpc.mockResolvedValue({ data: { outcome: "updated" }, error: null });
    await expect(
      repository.publishVerification(org, null, {
        version: 1,
        digest: "a".repeat(64),
        verified: true,
        capabilities: ["products"],
        policyRevision: 1,
        configurationDigest: "b".repeat(64),
        observedAt: "2026-10-13T00:00:00.000Z",
      }),
    ).resolves.toEqual({ outcome: "updated" });
    expect(rpc).toHaveBeenCalledWith(
      "m15_01_checkpoint_verification",
      expect.objectContaining({
        p_actor_user_id: null,
        p_effective_capabilities: ["products"],
      }),
    );
  });

  it("denies revoked identities without returning provider details", async () => {
    const { repository, rpc } = fixture();
    rpc.mockResolvedValue({ data: { outcome: "forbidden" }, error: null });
    await expect(repository.getState(org, "actor")).rejects.toMatchObject({
      response: { code: "forbidden" },
    });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "private" },
    });
    await expect(
      repository.checkpoint(org, "actor", "2026-10-13T00:00:00.000Z"),
    ).rejects.toMatchObject({ response: { code: "forbidden" } });
  });
});
it("attaches cancellation to real licence RPC IO", async () => {
  const { repository, rpc } = fixture();
  const signal = new AbortController().signal;
  const abortSignal = jest.fn().mockResolvedValue({
    data: {
      state: null,
      usage: {
        activeMembers: 0,
        reservedInvitations: 0,
        products: 0,
        storageBytes: 0,
      },
      storageAccountingReady: false,
    },
    error: null,
  });
  rpc.mockReturnValue({ abortSignal });
  await repository.getState(org, "actor", signal);
  expect(abortSignal).toHaveBeenCalledWith(signal);
});
