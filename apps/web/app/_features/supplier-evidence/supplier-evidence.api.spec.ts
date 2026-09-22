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
});
