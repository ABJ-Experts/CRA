import type {
  EvidenceExtractedTextResponse,
  EvidenceSearchQuery,
  EvidenceSearchResponse,
  RetryEvidenceExtractionInput,
  RetryEvidenceExtractionResponse,
} from "@repo/contracts/evidence";

export const EVIDENCE_TEXT_SEARCH_REPOSITORY = Symbol(
  "EVIDENCE_TEXT_SEARCH_REPOSITORY",
);

export interface EvidenceTextSearchRepository {
  search(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      query: EvidenceSearchQuery;
    }>,
  ): Promise<EvidenceSearchResponse | null>;
  extractedText(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
    }>,
  ): Promise<EvidenceExtractedTextResponse | null>;
  retryExtraction(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
      retry: RetryEvidenceExtractionInput;
    }>,
  ): Promise<RetryEvidenceExtractionResponse | null>;
}

/** The policy layer keeps controller transport free of text/index details. */
export class EvidenceTextSearchUseCases {
  constructor(private readonly repository: EvidenceTextSearchRepository) {}

  search(
    input: Parameters<EvidenceTextSearchRepository["search"]>[1] &
      Readonly<{ organizationId: string }>,
  ) {
    const { organizationId, ...request } = input;
    return this.repository.search(organizationId, request);
  }
  extractedText(
    input: Parameters<EvidenceTextSearchRepository["extractedText"]>[1] &
      Readonly<{ organizationId: string }>,
  ) {
    const { organizationId, ...request } = input;
    return this.repository.extractedText(organizationId, request);
  }
  retry(
    input: Parameters<EvidenceTextSearchRepository["retryExtraction"]>[1] &
      Readonly<{ organizationId: string }>,
  ) {
    const { organizationId, ...request } = input;
    return this.repository.retryExtraction(organizationId, request);
  }
}
