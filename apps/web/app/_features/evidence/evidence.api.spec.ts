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
    api.list(PRODUCT_ID, {
      status: "scan_pending",
      validity: "expiring_soon",
      limit: 25,
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-documents?status=scan_pending&validity=expiring_soon&limit=25`,
      }),
    );
  });

  it("uses validated product and version ids for reuse details", () => {
    const api = new EvidenceApi();

    api.reuse(PRODUCT_ID, DOCUMENT_ID, VERSION_ID);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-documents/${DOCUMENT_ID}/versions/${VERSION_ID}/reuse`,
      }),
    );
  });

  it("keeps expiry-interval updates at an explicit schema boundary", () => {
    const api = new EvidenceApi();

    api.updateExpiryAlertIntervals({
      thresholdDays: [30, 14, 7, 1],
      expectedVersion: 0,
      idempotencyKey: KEY,
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/v1/evidence-expiry-alert-intervals",
        method: "PATCH",
        inputSchema: expect.anything(),
      }),
    );
  });

  it("uses a product-scoped, normalized search route", () => {
    const api = new EvidenceApi();

    api.search(PRODUCT_ID, {
      q: "  secure   boot ",
      includeHistorical: true,
      limit: 25,
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-search?q=secure+boot&includeHistorical=true`,
      }),
    );
  });

  it("keeps extracted-text reads and explicit retries within the product version route", () => {
    const api = new EvidenceApi();

    api.extractedText(PRODUCT_ID, DOCUMENT_ID, VERSION_ID);
    api.retryExtraction(PRODUCT_ID, DOCUMENT_ID, VERSION_ID, {
      idempotencyKey: KEY,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-documents/${DOCUMENT_ID}/versions/${VERSION_ID}/extracted-text`,
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-documents/${DOCUMENT_ID}/versions/${VERSION_ID}/extraction/retry`,
        method: "POST",
        body: { idempotencyKey: KEY },
        inputSchema: expect.anything(),
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

  it("keeps the retention review and reviewed deletion command at parsed document boundaries", () => {
    const api = new EvidenceApi();
    api.retentionReview(DOCUMENT_ID);
    api.createDeletionIntent(DOCUMENT_ID, {
      expectedCurrentVersionId: VERSION_ID,
      reviewFingerprint: "a".repeat(64),
      confirmed: true,
      reason: "No longer required after review.",
      idempotencyKey: KEY,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: `/api/v1/evidence/${DOCUMENT_ID}/retention-review`,
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: `/api/v1/evidence/${DOCUMENT_ID}/deletion-intents`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
  });

  it("keeps legal-hold placement and individual release at explicit schema boundaries", () => {
    const api = new EvidenceApi();
    api.placeLegalHold(DOCUMENT_ID, {
      reason: "Preserve for regulator request.",
      idempotencyKey: KEY,
    });
    api.releaseLegalHold(DOCUMENT_ID, VERSION_ID, {
      reason: "Matter closed.",
      idempotencyKey: KEY,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: `/api/v1/evidence/${DOCUMENT_ID}/legal-holds`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: `/api/v1/evidence/${DOCUMENT_ID}/legal-holds/${VERSION_ID}/release`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
  });

  it("keeps durable bulk-intake batch and item mutations at parsed product boundaries", () => {
    const api = new EvidenceApi();
    api.createBulkIntakeBatch(PRODUCT_ID, {
      idempotencyKey: KEY,
      items: [
        {
          clientItemId: DOCUMENT_ID,
          idempotencyKey: VERSION_ID,
          title: "Gateway test report",
          ownerUserId: PRODUCT_ID,
          productIds: [PRODUCT_ID],
          validFrom: null,
          validUntil: null,
          fileName: "gateway.pdf",
          byteSize: 1,
        },
      ],
    });
    api.initializeBulkIntakeItem(PRODUCT_ID, DOCUMENT_ID, VERSION_ID, {
      documentClass: "test_report",
      classificationDecision: "accepted",
      idempotencyKey: KEY,
    });
    api.completeBulkIntakeItem(PRODUCT_ID, DOCUMENT_ID, VERSION_ID, {
      idempotencyKey: KEY,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-bulk-intake-batches`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-bulk-intake-batches/${DOCUMENT_ID}/items/${VERSION_ID}/initialize`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        path: `/api/v1/products/${PRODUCT_ID}/evidence-bulk-intake-batches/${DOCUMENT_ID}/items/${VERSION_ID}/complete`,
        method: "POST",
        body: { idempotencyKey: KEY },
        inputSchema: expect.anything(),
      }),
    );
  });

  it("uses the pinned source-version watermark export routes with parsed bodies", () => {
    const api = new EvidenceApi();
    api.createWatermarkExport(PRODUCT_ID, DOCUMENT_ID, VERSION_ID, {
      recipient: "Zoë Auditor",
      purpose: "External review",
      idempotencyKey: KEY,
    });
    api.previewWatermarkExport(PRODUCT_ID, DOCUMENT_ID, VERSION_ID, KEY, {
      idempotencyKey: KEY,
    });
    api.deliverWatermarkExport(PRODUCT_ID, DOCUMENT_ID, VERSION_ID, KEY, {
      idempotencyKey: KEY,
    });

    const root = `/api/v1/products/${PRODUCT_ID}/evidence-documents/${DOCUMENT_ID}/versions/${VERSION_ID}/watermark-exports/${KEY}`;
    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: root.slice(0, -KEY.length - 1),
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: `${root}/preview`, method: "POST" }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ path: `${root}/delivery`, method: "POST" }),
    );
  });
});
