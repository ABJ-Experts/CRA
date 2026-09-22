import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../_lib/http/authenticated-request", () => ({
  authenticatedRequestJson: request,
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

describe("SupplierEvidenceApi", () => {
  beforeEach(() => request.mockReset());

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
});
