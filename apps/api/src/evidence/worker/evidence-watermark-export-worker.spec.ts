import type { EvidenceWatermarkExport } from "@repo/contracts/evidence";
import type { EvidenceWatermarkExportRepository } from "../application/evidence-watermark-export-use-cases";
import { EvidenceWatermarkExportWorker } from "./evidence-watermark-export-worker";

const organizationId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const sourceVersionId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const documentId = "66666666-6666-4666-8666-666666666666";
const actorId = "77777777-7777-4777-8777-777777777777";

const watermarkExport: EvidenceWatermarkExport = {
  id: exportId,
  organizationId,
  productId,
  documentId,
  sourceVersionId,
  sourceSha256: "a".repeat(64),
  requestedByUserId: actorId,
  requestedAt: "2026-09-21T12:00:00.000Z",
  recipient: "External reviewer",
  purpose: "Review",
  status: "claimed",
  failureCode: null,
  derivative: null,
  previewedAt: null,
  deliveredAt: null,
};

describe("EvidenceWatermarkExportWorker", () => {
  it("writes a private derivative then finalizes the claimed source version", async () => {
    const finalizeWatermarkExport = jest.fn().mockResolvedValue(true);
    const upload = jest
      .fn<
        Promise<"stored">,
        [Readonly<{ objectKey: string; bytes: Buffer; mediaType: string }>]
      >()
      .mockResolvedValue("stored");
    const repository = {
      claimWatermarkExport: jest.fn().mockResolvedValue({
        export: watermarkExport,
        organizationId,
        objectKey: `${organizationId}/${documentId}/${sourceVersionId}/${sourceVersionId}`,
        sourceByteSize: 4,
        sourceMediaType: "image/png",
      }),
      finalizeWatermarkExport,
      failWatermarkExport: jest.fn(),
      isWatermarkExportDurablyFailed: jest.fn(),
    } as unknown as jest.Mocked<EvidenceWatermarkExportRepository>;
    const originals = {
      readVerified: jest.fn().mockResolvedValue(Buffer.from("test")),
    };
    const derivatives = {
      upload,
      remove: jest.fn(),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue({
        bytes: Buffer.from("derivative"),
        mediaType: "image/png",
      }),
    };
    const worker = new EvidenceWatermarkExportWorker({
      repository,
      originals: originals as never,
      derivatives: derivatives as never,
      renderer: renderer,
      leaseSeconds: 120,
    });

    await expect(worker.processOne(workerId)).resolves.toBe("ready");
    expect(originals.readVerified).toHaveBeenCalledWith({
      objectKey: `${organizationId}/${documentId}/${sourceVersionId}/${sourceVersionId}`,
      sha256: "a".repeat(64),
      byteSize: 4,
      mediaType: "image/png",
    });
    expect(upload.mock.calls[0]?.[0].objectKey).toMatch(
      new RegExp(`^${organizationId}/${exportId}/`),
    );
    expect(finalizeWatermarkExport.mock.calls[0]).toEqual([
      organizationId,
      expect.objectContaining({ exportId, workerId }),
    ]);
  });

  it("only removes a partially-written private derivative after durable failure", async () => {
    const failWatermarkExport = jest.fn().mockResolvedValue(true);
    const remove = jest.fn().mockResolvedValue("deleted");
    const repository = {
      claimWatermarkExport: jest.fn().mockResolvedValue({
        export: watermarkExport,
        organizationId,
        objectKey: `${organizationId}/${documentId}/${sourceVersionId}/${sourceVersionId}`,
        sourceByteSize: 4,
        sourceMediaType: "image/png",
      }),
      finalizeWatermarkExport: jest.fn().mockResolvedValue(false),
      failWatermarkExport,
      isWatermarkExportDurablyFailed: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<EvidenceWatermarkExportRepository>;
    const derivatives = {
      upload: jest.fn().mockResolvedValue("stored"),
      remove,
    };
    const worker = new EvidenceWatermarkExportWorker({
      repository,
      originals: {
        readVerified: jest.fn().mockResolvedValue(Buffer.from("test")),
      } as never,
      derivatives: derivatives as never,
      renderer: {
        render: jest.fn().mockResolvedValue({
          bytes: Buffer.from("derivative"),
          mediaType: "image/png",
        }),
      },
      leaseSeconds: 120,
    });

    await expect(worker.processOne(workerId)).resolves.toBe("failed");
    expect(failWatermarkExport.mock.calls.length).toBeGreaterThan(0);
    expect(remove.mock.calls).toHaveLength(1);
  });
});
