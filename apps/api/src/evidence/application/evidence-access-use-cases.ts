import { createHash, randomBytes, randomUUID } from "node:crypto";

export const EVIDENCE_ACCESS_REPOSITORY = Symbol("EVIDENCE_ACCESS_REPOSITORY");

export type EvidenceAccessSource = Readonly<{
  versionId: string;
  objectKey: string;
  fileName: string;
  mediaType: string;
  sha256: string;
  byteSize: number;
  mode: "preview" | "download" | "export";
}>;

export interface EvidenceAccessRepository {
  authorize(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
      mode: "preview" | "download" | "export";
      purpose: string | null;
      correlationId: string;
      tokenDigest: string;
      expiresAt: string;
    }>,
  ): Promise<
    | Readonly<{ outcome: "ready"; source: EvidenceAccessSource }>
    | Readonly<{
        outcome:
          "expired" | "not_found" | "not_clean" | "forbidden" | "conflict";
      }>
  >;
  redeem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      tokenDigest: string;
      correlationId: string;
      rangeStart: number | null;
      rangeEnd: number | null;
    }>,
  ): Promise<
    | Readonly<{ outcome: "ready"; source: EvidenceAccessSource }>
    | Readonly<{
        outcome:
          "expired" | "not_found" | "not_clean" | "forbidden" | "conflict";
      }>
  >;
  integrityFailure(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      versionId: string;
      correlationId: string;
    }>,
  ): Promise<void>;
}

export class EvidenceAccessUseCases {
  constructor(private readonly repository: EvidenceAccessRepository) {}

  async authorize(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
      disposition: "inline" | "attachment";
      purpose: string | null;
    }>,
  ) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const result = await this.repository.authorize(input.organizationId, {
      actorId: input.actorId,
      productId: input.productId,
      documentId: input.documentId,
      versionId: input.versionId,
      mode: input.disposition === "inline" ? "preview" : "download",
      purpose: input.purpose,
      correlationId: randomUUID(),
      tokenDigest: digest(token),
      expiresAt,
    });
    if (result.outcome !== "ready") return result;
    const previewSupported =
      result.source.mediaType === "application/pdf" ||
      result.source.mediaType.startsWith("image/");
    if (input.disposition === "inline" && !previewSupported)
      return { outcome: "unsupported" as const };
    return Object.freeze({
      outcome: "ready" as const,
      token,
      expiresAt,
      source: result.source,
      previewSupported,
    });
  }

  async redeem(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      token: string;
      rangeStart: number | null;
      rangeEnd: number | null;
    }>,
  ) {
    const correlationId = randomUUID();
    const result = await this.repository.redeem(input.organizationId, {
      actorId: input.actorId,
      tokenDigest: digest(input.token),
      correlationId,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
    });
    return result.outcome === "ready"
      ? Object.freeze({ ...result, correlationId })
      : result;
  }

  integrityFailure(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      versionId: string;
      correlationId: string;
    }>,
  ) {
    return this.repository.integrityFailure(input.organizationId, input);
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
