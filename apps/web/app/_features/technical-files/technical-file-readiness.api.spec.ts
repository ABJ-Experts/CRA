import { afterEach, describe, expect, it, vi } from "vitest";

import { technicalFilesApi } from "./technical-files.api";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-4333-8333-333333333333";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("technicalFilesApi readiness endpoints", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads product-scoped readiness through the versioned technical-file route", async () => {
    const fetcher = vi.fn(async () =>
      json({
        readiness: {
          technicalFileId: PRODUCT_ID,
          overallStatus: "empty",
          recalculationStatus: "current",
          calculatedAt: null,
          sections: [],
          gaps: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(technicalFilesApi.getReadiness(PRODUCT_ID)).resolves.toEqual(
      expect.objectContaining({ readiness: expect.any(Object) }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/technical-file/readiness`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("validates a stale-source review and does not issue a malformed mutation", async () => {
    const fetcher = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      technicalFilesApi.reviewSource(
        PRODUCT_ID,
        "general_description",
        SOURCE_ID,
        {
          expectedVersion: 1,
          decision: "retain",
          rationale: "",
          idempotencyKey: IDEMPOTENCY_KEY,
        },
      ),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
