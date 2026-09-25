import { afterEach, describe, expect, it, vi } from "vitest";

import { findingImpactApi } from "./finding-impact.api";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

const SUMMARY = {
  summary: {
    productId: PRODUCT_ID,
    releaseId: null,
    activeImpactCount: 2,
    supersededImpactCount: 0,
    closedImpactCount: 0,
    overrideCount: 0,
    latestGraphVersion: 4,
    latestEvaluatedAt: "2026-08-14T10:00:00.000Z",
    propagationState: "idle",
    queuedJobCount: 0,
    inProgressJobCount: 0,
    retryingJobCount: 0,
    deadLetterJobCount: 0,
  },
} as const;

describe("findingImpactApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the protected product summary endpoint with parsed optional release scope", async () => {
    const fetcher = vi.fn(async () => json(SUMMARY));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      findingImpactApi.getProductSummary(PRODUCT_ID, { releaseId: RELEASE_ID }),
    ).resolves.toEqual(SUMMARY);

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/finding-impact-summary?releaseId=${RELEASE_ID}`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("rejects malformed product and release identifiers before transport", async () => {
    const fetcher = vi.fn(async () => json(SUMMARY));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      findingImpactApi.getProductSummary("not-a-uuid"),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    await expect(
      findingImpactApi.getProductSummary(PRODUCT_ID, { releaseId: "bad" }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
