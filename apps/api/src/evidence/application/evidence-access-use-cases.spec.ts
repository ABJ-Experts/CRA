import { createHash } from "node:crypto";
import {
  EvidenceAccessUseCases,
  type EvidenceAccessRepository,
} from "./evidence-access-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const documentId = "00000000-0000-4000-8000-000000000004";
const versionId = "00000000-0000-4000-8000-000000000005";

function source(mediaType = "application/pdf") {
  return {
    versionId,
    objectKey: `${organizationId}/${documentId}/${versionId}/00000000-0000-4000-8000-000000000006`,
    fileName: "report.pdf",
    mediaType,
    sha256: "a".repeat(64),
    byteSize: 7,
    mode: "preview" as const,
  };
}

describe("EvidenceAccessUseCases", () => {
  it("issues an opaque five-minute actor-bound grant without exposing storage", async () => {
    const authorize = jest
      .fn<
        ReturnType<EvidenceAccessRepository["authorize"]>,
        Parameters<EvidenceAccessRepository["authorize"]>
      >()
      .mockResolvedValue({ outcome: "ready", source: source() });
    const repository = {
      authorize,
      redeem: jest.fn(),
      integrityFailure: jest.fn(),
    } as unknown as jest.Mocked<EvidenceAccessRepository>;
    const useCases = new EvidenceAccessUseCases(repository);
    const result = await useCases.authorize({
      organizationId,
      actorId,
      productId,
      documentId,
      versionId,
      disposition: "inline",
      purpose: null,
    });
    expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toBeDefined();
    expect(authorize).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({
        actorId,
        mode: "preview",
        tokenDigest: createHash("sha256").update(result.token).digest("hex"),
      }),
    );
  });

  it("does not treat unsupported content as previewable", async () => {
    const repository = {
      authorize: jest
        .fn()
        .mockResolvedValue({ outcome: "ready", source: source("text/plain") }),
      redeem: jest.fn(),
      integrityFailure: jest.fn(),
    } as unknown as jest.Mocked<EvidenceAccessRepository>;
    const result = await new EvidenceAccessUseCases(repository).authorize({
      organizationId,
      actorId,
      productId,
      documentId,
      versionId,
      disposition: "inline",
      purpose: null,
    });
    expect(result).toEqual({ outcome: "unsupported" });
  });
});
