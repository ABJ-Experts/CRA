import { SupabaseService } from "../../supabase/supabase.service";
import {
  sbomRequestDigest,
  SupabaseSbomRepository,
} from "./supabase-sbom.repository";

describe("sbomRequestDigest", () => {
  const input = {
    productId: "11111111-1111-4111-8111-111111111111",
    releaseId: "22222222-2222-4222-8222-222222222222",
    filename: "release.sbom.json",
    byteSize: 42,
    mediaType: "application/json",
    sha256: "a".repeat(64),
    source: "manual_upload" as const,
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
  };

  it("is stable when server-generated correlation and verified identity change", () => {
    const firstInput = {
      ...input,
      // Deliberately excess values: the digest accepts and ignores these.
      correlationId: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      actorId: "66666666-6666-4666-8666-666666666666",
    };
    const retriedInput = {
      ...input,
      correlationId: "77777777-7777-4777-8777-777777777777",
      organizationId: "88888888-8888-4888-8888-888888888888",
      actorId: "99999999-9999-4999-8999-999999999999",
    };
    const first = sbomRequestDigest(firstInput);
    const retried = sbomRequestDigest(retriedInput);

    expect(retried).toBe(first);
  });

  it("changes for a materially different client intake request", () => {
    expect(sbomRequestDigest({ ...input, byteSize: 43 })).not.toBe(
      sbomRequestDigest(input),
    );
  });
});

describe("SupabaseSbomRepository replay mapping", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const jobId = "33333333-3333-4333-8333-333333333333";
  const sourceId = "44444444-4444-4444-8444-444444444444";
  const input = {
    jobId,
    actorId,
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
  };
  const job = {
    id: jobId,
    organizationId,
    releaseId: "66666666-6666-4666-8666-666666666666",
    sourceId,
    inputSha256: "a".repeat(64),
    correlationId: "77777777-7777-4777-8777-777777777777",
    status: "queued",
    progress: { stage: "queued", percent: 0, message: "Queued" },
    attempts: 0,
    maxAttempts: 5,
    error: null,
    result: null,
    createdAt: "2026-08-20T11:00:00.000Z",
    updatedAt: "2026-08-20T11:00:00.000Z",
    completedAt: null,
  };
  const subject = (row: Record<string, unknown>) =>
    new SupabaseSbomRepository({
      admin: () => ({
        rpc: () => Promise.resolve({ data: [row], error: null }),
      }),
    } as unknown as SupabaseService);

  it.each(["queued", "replayed"] as const)(
    "returns the job for %s replay outcomes",
    async (outcome) => {
      await expect(
        subject({ outcome, job }).replay(organizationId, input),
      ).resolves.toMatchObject({
        outcome,
        job: { id: jobId },
      });
    },
  );

  it.each(["invalid_state", "idempotency_mismatch"] as const)(
    "maps %s replay outcome to a stable conflict",
    async (outcome) => {
      await expect(
        subject({ outcome, job: null }).replay(organizationId, input),
      ).resolves.toEqual({
        outcome: "conflict",
      });
    },
  );
});
