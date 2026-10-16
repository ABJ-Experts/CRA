import { createHmac, createHash } from "node:crypto";

import {
  SupplierEvidenceSbomNotFoundError,
  SupplierEvidenceSbomUseCases,
} from "./supplier-evidence-sbom.use-cases";

const sessionToken = "supplier-evidence-session-token-0123456789";
const checklistItemId = "00000000-0000-4000-8000-000000000021";
const sourceId = "00000000-0000-4000-8000-000000000022";

describe("SupplierEvidenceSbomUseCases", () => {
  const repository = {
    activate: jest.fn(),
    eligible: jest.fn(),
  };
  const supplierSboms = {
    initializeUpload: jest.fn(),
    completeUpload: jest.fn(),
  };
  const useCases = new SupplierEvidenceSbomUseCases(repository, supplierSboms);

  beforeEach(() => jest.resetAllMocks());

  it("activates only the linked item before delegating reservation to M3", async () => {
    repository.activate.mockResolvedValue({ outcome: "created" });
    supplierSboms.initializeUpload.mockResolvedValue({
      submission: { id: "submission" },
      upload: {
        uploadUrl: "https://local.test/upload",
        expiresAt: "2026-09-24T00:00:00Z",
      },
    });

    await useCases.initialize({
      sessionToken,
      checklistItemId,
      fileName: "supplier.cdx.json",
      byteSize: 123,
      mediaType: "application/json",
      sha256: "a".repeat(64),
      idempotencyKey: "00000000-0000-4000-8000-000000000023",
    });

    const sbomToken = createHmac("sha256", sessionToken)
      .update(`m9-06:${checklistItemId}`)
      .digest("base64url");
    expect(repository.activate).toHaveBeenCalledWith({
      sessionTokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      checklistItemId,
      sbomSessionTokenHash: createHash("sha256")
        .update(sbomToken)
        .digest("hex"),
    });
    expect(supplierSboms.initializeUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionToken: sbomToken,
        filename: "supplier.cdx.json",
      }),
    );
  });

  it("never touches storage when the M9 grant is revoked", async () => {
    repository.activate.mockResolvedValue({ outcome: "not_found" });
    await expect(
      useCases.complete({
        sessionToken,
        checklistItemId,
        sourceId,
        idempotencyKey: "00000000-0000-4000-8000-000000000024",
      }),
    ).rejects.toBeInstanceOf(SupplierEvidenceSbomNotFoundError);
    expect(supplierSboms.completeUpload).not.toHaveBeenCalled();
  });

  it("reuses the same scoped M3 session for finalization retries", async () => {
    repository.activate.mockResolvedValue({ outcome: "replayed" });
    supplierSboms.completeUpload.mockResolvedValue({
      submission: { id: "submission" },
    });

    await useCases.complete({
      sessionToken,
      checklistItemId,
      sourceId,
      idempotencyKey: "00000000-0000-4000-8000-000000000024",
    });
    expect(supplierSboms.completeUpload).toHaveBeenCalledWith({
      sessionToken: createHmac("sha256", sessionToken)
        .update(`m9-06:${checklistItemId}`)
        .digest("base64url"),
      sourceId,
      idempotencyKey: "00000000-0000-4000-8000-000000000024",
    });
  });
});
