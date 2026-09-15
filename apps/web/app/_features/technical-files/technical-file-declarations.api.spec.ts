import { afterEach, describe, expect, it, vi } from "vitest";

import { technicalFilesApi } from "./technical-files.api";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const DECLARATION_ID = "33333333-3333-4333-8333-333333333333";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("technical-file declaration gateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses product-scoped declaration history and preview endpoints", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
      json({ declarations: [] }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      technicalFilesApi.listDeclarations(PRODUCT_ID),
    ).resolves.toEqual({
      declarations: [],
    });

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/technical-file/declarations`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    expect(() =>
      technicalFilesApi.previewDeclaration(PRODUCT_ID, "not-a-uuid"),
    ).toThrow("The technical-file snapshot identifier is invalid.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete notified-body draft data before issuing a mutation", async () => {
    const fetcher = vi.fn(async () => json({ declaration: {} }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      technicalFilesApi.saveDeclarationDraft(PRODUCT_ID, {
        snapshotId: SNAPSHOT_ID,
        expectedVersion: 1,
        signatoryCapacity: "Managing director",
        signatoryPlace: "Brussels",
        assessmentRoute: "eu_type_examination",
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(() =>
      technicalFilesApi.downloadDeclaration(PRODUCT_ID, "invalid"),
    ).toThrow("The declaration identifier is invalid.");
    expect(DECLARATION_ID).toHaveLength(36);
  });
});
