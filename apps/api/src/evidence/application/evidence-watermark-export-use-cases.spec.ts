import type { EvidenceWatermarkExportRepository } from "./evidence-watermark-export-use-cases";
import {
  evidenceWatermarkAccessRequestDigest,
  evidenceWatermarkExportRequestDigest,
  EvidenceWatermarkExportUseCases,
} from "./evidence-watermark-export-use-cases";

describe("EvidenceWatermarkExportUseCases", () => {
  it("uses the database-issued opaque token for preview access", async () => {
    const createWatermarkPreviewAccess = jest.fn().mockResolvedValue({
      outcome: "ready",
      access: {
        token: "a".repeat(43),
        expiresAt: "2026-09-21T12:05:00.000Z",
        fileName: "watermarked.pdf",
        mediaType: "application/pdf",
      },
    });
    const repository = {
      createWatermarkPreviewAccess,
    } as unknown as jest.Mocked<EvidenceWatermarkExportRepository>;
    const useCases = new EvidenceWatermarkExportUseCases(repository);

    const result = await useCases.preview({
      organizationId: "11111111-1111-4111-8111-111111111111",
      actorId: "22222222-2222-4222-8222-222222222222",
      exportId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });

    expect(result.outcome).toBe("ready");
    if (result.outcome === "ready")
      expect(result.access.token).toBe("a".repeat(43));
    expect(createWatermarkPreviewAccess.mock.calls[0]).toEqual([
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        requestDigest: evidenceWatermarkAccessRequestDigest({
          exportId: "33333333-3333-4333-8333-333333333333",
          mode: "preview",
        }),
      }),
    ]);
  });

  it("pins watermark export fingerprints without JSON stringification", () => {
    expect(
      evidenceWatermarkExportRequestDigest({
        productId: "11111111-1111-4111-8111-111111111111",
        documentId: "22222222-2222-4222-8222-222222222222",
        versionId: "33333333-3333-4333-8333-333333333333",
        recipient: "Reviewer Long Name",
        purpose: "External review",
      }),
    ).toMatch(/^[a-f0-9]{64}$/);

    expect(
      evidenceWatermarkAccessRequestDigest({
        exportId: "33333333-3333-4333-8333-333333333333",
        mode: "preview",
      }),
    ).not.toEqual(
      evidenceWatermarkAccessRequestDigest({
        exportId: "33333333-3333-4333-8333-333333333333",
        mode: "delivery",
      }),
    );
  });
});
