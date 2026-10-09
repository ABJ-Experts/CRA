import { afterEach, describe, expect, it, vi } from "vitest";

import { technicalFilesApi } from "./technical-files.api";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const EXPORT_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("technical-file snapshot gateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the product-scoped snapshot endpoint and validates the create command", async () => {
    const fetcher = vi.fn(async () => json({ snapshots: [] }));
    vi.stubGlobal("fetch", fetcher);

    await expect(technicalFilesApi.listSnapshots(PRODUCT_ID)).resolves.toEqual({
      snapshots: [],
    });
    await expect(
      technicalFilesApi.createSnapshot(PRODUCT_ID, {
        expectedTechnicalFileVersion: 2,
        purpose: "release",
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/v1/products/${PRODUCT_ID}/technical-file/snapshots`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe download identifiers before requesting a signed artifact URL", async () => {
    const fetcher = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetcher);

    expect(() =>
      technicalFilesApi.downloadSnapshotExport(
        PRODUCT_ID,
        SNAPSHOT_ID,
        EXPORT_ID,
        "not-an-artifact",
      ),
    ).toThrow("The requested export artifact is invalid.");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
