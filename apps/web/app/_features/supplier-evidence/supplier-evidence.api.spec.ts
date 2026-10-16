import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
const publicRequest = vi.hoisted(() => vi.fn());
vi.mock("../../_lib/http/authenticated-request", () => ({
  authenticatedRequestJson: request,
}));
vi.mock("../../_lib/http/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../_lib/http/api-client")>()),
  requestJson: publicRequest,
}));

import { ApiClientError } from "../../_lib/http/api-client";
import { SupplierEvidenceApi } from "./supplier-evidence.api";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const KEY = "33333333-3333-4333-8333-333333333333";
const FINGERPRINT = "a".repeat(64);
const SUBMISSION_ID = "44444444-4444-4444-8444-444444444444";
const EVIDENCE_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const UPDATED_AT = "2026-09-22T00:00:00.000Z";
const DELIVERY_ID = "99999999-9999-4999-8999-999999999999";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";

describe("SupplierEvidenceApi", () => {
  beforeEach(() => {
    request.mockReset();
    publicRequest.mockReset();
  });

  it("lists only eligible scoped supplier SBOM requests through a parsed internal boundary", () => {
    const api = new SupplierEvidenceApi();
    api.eligibleSbomRequests({
      supplierId: "77777777-7777-4777-8777-777777777777",
      productId: PRODUCT_ID,
      limit: 25,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/supplier-evidence-requests/eligible-sbom-requests?productId=${PRODUCT_ID}&supplierId=77777777-7777-4777-8777-777777777777&limit=25`,
        schema: expect.anything(),
      }),
    );
    expect(() =>
      api.eligibleSbomRequests({
        supplierId: "not-a-uuid",
        productId: PRODUCT_ID,
      }),
    ).toThrow(ApiClientError);
  });

  it("uses only scoped M9 portal SBOM item routes with parsed request and response schemas", () => {
    const api = new SupplierEvidenceApi();
    const itemId = "88888888-8888-4888-8888-888888888888";
    const sourceId = "99999999-9999-4999-8999-999999999999";
    const sessionToken = "a".repeat(32);
    api.initializeSbomPortalUpload(itemId, {
      sessionToken,
      fileName: "component.cdx.json",
      mediaType: "application/json",
      byteSize: 12,
      sha256: "b".repeat(64),
      declaredFormat: "cyclonedx",
      idempotencyKey: KEY,
    });
    api.completeSbomPortalUpload(itemId, sourceId, {
      sessionToken,
      idempotencyKey: KEY,
    });
    expect(publicRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: `/api/v1/supplier-evidence-portal/sbom-items/${itemId}/submissions`,
        method: "POST",
        inputSchema: expect.anything(),
        schema: expect.anything(),
      }),
    );
    expect(publicRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: `/api/v1/supplier-evidence-portal/sbom-items/${itemId}/submissions/${sourceId}/complete`,
        method: "POST",
        inputSchema: expect.anything(),
        schema: expect.anything(),
      }),
    );
    expect(() =>
      api.initializeSbomPortalUpload("not-a-uuid", {
        sessionToken,
        fileName: "component.cdx.json",
        mediaType: "application/json",
        byteSize: 12,
        sha256: "b".repeat(64),
        idempotencyKey: KEY,
      }),
    ).toThrow(ApiClientError);
  });

  it("keeps issue mutations in the internal request namespace with a parsed boundary", () => {
    const api = new SupplierEvidenceApi();
    api.issue(REQUEST_ID, {
      revisionId: REVISION_ID,
      expectedVersion: 2,
      previewFingerprint: FINGERPRINT,
      idempotencyKey: KEY,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/supplier-evidence-requests/${REQUEST_ID}/issue`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
  });

  it("rejects malformed request IDs before any internal request", () => {
    const api = new SupplierEvidenceApi();
    expect(() => api.detail("not-a-uuid")).toThrow(ApiClientError);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the permission-scoped review projection instead of normal request detail", () => {
    const api = new SupplierEvidenceApi();
    api.reviewDetail(REQUEST_ID);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/supplier-evidence-requests/${REQUEST_ID}/review`,
        schema: expect.anything(),
      }),
    );
  });

  it("forwards supplier, product, state, and pagination filters through the typed request-list boundary", () => {
    const api = new SupplierEvidenceApi();
    api.list({
      productId: "66666666-6666-4666-8666-666666666666",
      supplierId: "77777777-7777-4777-8777-777777777777",
      state: "open",
      limit: 10,
      cursor: "88888888-8888-4888-8888-888888888888",
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/v1/supplier-evidence-requests?productId=66666666-6666-4666-8666-666666666666&supplierId=77777777-7777-4777-8777-777777777777&state=open&limit=10&cursor=88888888-8888-4888-8888-888888888888",
        schema: expect.anything(),
      }),
    );
  });

  it("uses typed boundaries for reminder settings, metrics, overdue rows, and an explicit delivery retry", () => {
    const api = new SupplierEvidenceApi();
    api.reminderSettings();
    api.updateReminderSettings({
      expectedVersion: 2,
      offsetsHours: [-168, -24, 24],
      idempotencyKey: KEY,
    });
    api.metrics({
      from: "2026-08-22T00:00:00.000Z",
      to: "2026-09-22T00:00:00.000Z",
      supplierId: "77777777-7777-4777-8777-777777777777",
    });
    api.overdue({ supplierId: "77777777-7777-4777-8777-777777777777" });
    api.retryReminder(REQUEST_ID, DELIVERY_ID, {
      expectedVersion: 3,
      idempotencyKey: KEY,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: "/api/v1/supplier-evidence-requests/reminder-settings",
        schema: expect.anything(),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "/api/v1/supplier-evidence-requests/reminder-settings",
        method: "PATCH",
        inputSchema: expect.anything(),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        path: "/api/v1/supplier-evidence-requests/metrics?from=2026-08-22T00%3A00%3A00.000Z&to=2026-09-22T00%3A00%3A00.000Z&supplierId=77777777-7777-4777-8777-777777777777",
        schema: expect.anything(),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        path: "/api/v1/supplier-evidence-requests/overdue?supplierId=77777777-7777-4777-8777-777777777777&limit=25",
        schema: expect.anything(),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        path: `/api/v1/supplier-evidence-requests/${REQUEST_ID}/reminder-deliveries/${DELIVERY_ID}/retry`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
  });

  it("keeps attributable review decisions in the internal request namespace", () => {
    const api = new SupplierEvidenceApi();
    api.reviewSubmission(REQUEST_ID, SUBMISSION_ID, {
      expectedRequestVersion: 2,
      expectedSubmissionUpdatedAt: UPDATED_AT,
      expectedEvidenceVersionId: EVIDENCE_VERSION_ID,
      expectedSha256: FINGERPRINT,
      decision: "accept",
      idempotencyKey: KEY,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/supplier-evidence-requests/${REQUEST_ID}/submissions/${SUBMISSION_ID}/review`,
        method: "POST",
        inputSchema: expect.anything(),
      }),
    );
  });

  it("rejects malformed submission IDs before an attributable review request", () => {
    const api = new SupplierEvidenceApi();
    expect(() =>
      api.reviewSubmission(REQUEST_ID, "not-a-uuid", {
        expectedRequestVersion: 2,
        expectedSubmissionUpdatedAt: UPDATED_AT,
        expectedEvidenceVersionId: EVIDENCE_VERSION_ID,
        expectedSha256: FINGERPRINT,
        decision: "accept",
        idempotencyKey: KEY,
      }),
    ).toThrow(ApiClientError);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses parsed and product-scoped extraction endpoints", () => {
    const api = new SupplierEvidenceApi();
    const pin = {
      productId: PRODUCT_ID,
      expectedRequestVersion: 2,
      expectedSubmissionUpdatedAt: UPDATED_AT,
      expectedEvidenceVersionId: EVIDENCE_VERSION_ID,
      expectedSha256: FINGERPRINT,
      idempotencyKey: KEY,
    };
    api.extraction(REQUEST_ID, SUBMISSION_ID, PRODUCT_ID);
    api.startExtraction(REQUEST_ID, SUBMISSION_ID, pin);
    api.decideField(REQUEST_ID, SUBMISSION_ID, DELIVERY_ID, {
      ...pin,
      expectedFieldVersion: 0,
      decision: "confirm",
      correctedValue: "ISO 9001",
    });
    api.createManualField(REQUEST_ID, SUBMISSION_ID, {
      ...pin,
      fieldKey: "scope",
      value: "Manufacturing",
    });
    expect(request.mock.calls.map(([value]) => value.path)).toEqual([
      `/api/v1/supplier-evidence-requests/${REQUEST_ID}/submissions/${SUBMISSION_ID}/extraction?productId=${PRODUCT_ID}&limit=25`,
      `/api/v1/supplier-evidence-requests/${REQUEST_ID}/submissions/${SUBMISSION_ID}/extraction-runs`,
      `/api/v1/supplier-evidence-requests/${REQUEST_ID}/submissions/${SUBMISSION_ID}/fields/${DELIVERY_ID}/decision`,
      `/api/v1/supplier-evidence-requests/${REQUEST_ID}/submissions/${SUBMISSION_ID}/fields/manual`,
    ]);
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      method: "POST",
      inputSchema: expect.anything(),
      schema: expect.anything(),
    });
    expect(request.mock.calls[2]?.[0]).toMatchObject({
      method: "POST",
      inputSchema: expect.anything(),
      schema: expect.anything(),
    });
  });

  it("passes an opaque extraction cursor through a bounded read query", () => {
    const api = new SupplierEvidenceApi();
    api.extraction(
      REQUEST_ID,
      SUBMISSION_ID,
      PRODUCT_ID,
      undefined,
      "opaque-keyset",
      100,
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/supplier-evidence-requests/${REQUEST_ID}/submissions/${SUBMISSION_ID}/extraction?productId=${PRODUCT_ID}&limit=100&cursor=opaque-keyset`,
      }),
    );
    expect(() =>
      api.extraction(
        REQUEST_ID,
        SUBMISSION_ID,
        PRODUCT_ID,
        undefined,
        "opaque-keyset",
        101,
      ),
    ).toThrow(ApiClientError);
  });
});
