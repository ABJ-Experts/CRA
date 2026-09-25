import {
  SupplierSbomUseCases,
  type SupplierSbomRepository,
} from "./supplier-sbom-use-cases";
import type { SbomStoragePort } from "./sbom-intake-use-cases";

const reservation = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  productId: "33333333-3333-4333-8333-333333333333",
  releaseId: "44444444-4444-4444-8444-444444444444",
  source: "supplier" as const,
  objectKey: "object",
  filename: "supplier.json",
  byteSize: 10,
  mediaType: "application/json",
  sha256: "a".repeat(64),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  status: "upload_pending" as const,
  createdAt: new Date().toISOString(),
  completedAt: null,
};

describe("SupplierSbomUseCases", () => {
  it("binds a caller-generated session secret so a lost exchange response can retry safely", async () => {
    const exchangeInvitation = jest.fn().mockResolvedValue({
      outcome: "created",
      session: {
        sessionToken: "s".repeat(32),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        requestReference: "request",
        allowedComponentRef: "component",
      },
    });
    const useCases = new SupplierSbomUseCases(
      { exchangeInvitation } as unknown as SupplierSbomRepository,
      {} as SbomStoragePort,
    );

    const result = await useCases.exchangeInvitation({
      invitationToken: "i".repeat(32),
      sessionToken: "s".repeat(32),
    });

    expect(result.ok).toBe(true);
    expect(exchangeInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        invitationToken: "i".repeat(32),
        sessionToken: "s".repeat(32),
      }),
    );
  });

  it("inspects supplier bytes server-side before finalizing", async () => {
    const completeUpload = jest.fn().mockResolvedValue({
      outcome: "queued",
      job: {
        id: "55555555-5555-4555-8555-555555555555",
        sourceId: reservation.id,
      },
      submission: submission(),
    });
    const repository = {
      getUploadForCompletion: jest.fn().mockResolvedValue({
        outcome: "ready",
        reservation: {
          objectKey: reservation.objectKey,
          sha256: reservation.sha256,
          byteSize: reservation.byteSize,
          mediaType: reservation.mediaType,
        },
      }),
      completeUpload,
    } as unknown as SupplierSbomRepository;
    const storage = {
      inspect: jest.fn().mockResolvedValue({
        outcome: "verified",
        sha256: reservation.sha256,
        byteSize: reservation.byteSize,
        contentType: reservation.mediaType,
      }),
    } as unknown as SbomStoragePort;
    const useCases = new SupplierSbomUseCases(repository, storage);

    const result = await useCases.completeUpload({
      sessionToken: "session",
      sourceId: reservation.id,
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    });

    expect(result.ok).toBe(true);
    expect(completeUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        actualHash: reservation.sha256,
        actualByteSize: reservation.byteSize,
        actualMediaType: reservation.mediaType,
      }),
    );
  });

  it("does not finalize when private storage bytes are missing", async () => {
    const completeUpload = jest.fn();
    const repository = {
      getUploadForCompletion: jest.fn().mockResolvedValue({
        outcome: "ready",
        reservation: {
          objectKey: reservation.objectKey,
          sha256: reservation.sha256,
          byteSize: reservation.byteSize,
          mediaType: reservation.mediaType,
        },
      }),
      completeUpload,
    } as unknown as SupplierSbomRepository;
    const storage = {
      inspect: jest.fn().mockResolvedValue({ outcome: "missing" }),
    } as unknown as SbomStoragePort;
    const result = await new SupplierSbomUseCases(
      repository,
      storage,
    ).completeUpload({
      sessionToken: "session",
      sourceId: reservation.id,
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    });

    expect(result).toEqual({ ok: false, error: { code: "source_missing" } });
    expect(completeUpload).not.toHaveBeenCalled();
  });
});

function submission() {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    requestId: "88888888-8888-4888-8888-888888888888",
    sourceId: reservation.id,
    state: "processing" as const,
    fileName: "supplier.json",
    mediaType: "application/json",
    byteSize: 10,
    sha256: "a".repeat(64),
    validationMessage: null,
    reviewReason: null,
    reviewedAt: null,
    reviewedBy: null,
    supersededBySubmissionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
