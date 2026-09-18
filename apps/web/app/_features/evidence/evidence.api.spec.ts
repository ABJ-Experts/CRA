import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { EvidenceApi } from "./evidence.api";

const request = vi.hoisted(() => vi.fn());

vi.mock("../../_lib/http/authenticated-request", () => ({
  authenticatedRequestJson: request,
}));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const KEY = "44444444-4444-4444-8444-444444444444";

describe("EvidenceApi", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("validates the product route before issuing an evidence-list request", () => {
    const api = new EvidenceApi();

    expect(() => api.list("not-a-uuid")).toThrow(ApiClientError);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the parsed product route and bounded list query", () => {
    const api = new EvidenceApi();
    api.list(PRODUCT_ID, { status: "scan_pending", limit: 25 });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-documents?status=scan_pending&limit=25`,
      }),
    );
  });

  it("keeps upload commands at a schema boundary", () => {
    const api = new EvidenceApi();
    api.complete(VERSION_ID, { idempotencyKey: KEY });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/evidence-uploads/${VERSION_ID}/complete`,
        method: "POST",
        body: { idempotencyKey: KEY },
        inputSchema: expect.anything(),
        schema: expect.anything(),
      }),
    );
  });

  it("rejects invalid identifiers before requesting version history", () => {
    const api = new EvidenceApi();

    expect(() => api.versions(PRODUCT_ID, "unsafe")).toThrow(ApiClientError);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the product-scoped access route and validates both evidence ids", () => {
    const api = new EvidenceApi();

    api.access(PRODUCT_ID, DOCUMENT_ID, VERSION_ID, { disposition: "inline" });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-documents/${DOCUMENT_ID}/versions/${VERSION_ID}/access`,
        method: "POST",
        body: { disposition: "inline" },
      }),
    );
  });

  it("keeps replacement creation at the runtime schema boundary", () => {
    const api = new EvidenceApi();
    api.replace({
      documentId: DOCUMENT_ID,
      expectedCurrentVersionId: VERSION_ID,
      title: "Updated risk assessment",
      documentClass: "risk_assessment",
      ownerUserId: PRODUCT_ID,
      productIds: [PRODUCT_ID],
      validFrom: null,
      validUntil: null,
      fileName: "updated.pdf",
      byteSize: 10,
      idempotencyKey: KEY,
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/evidence-documents/${DOCUMENT_ID}/versions`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
  });
});
