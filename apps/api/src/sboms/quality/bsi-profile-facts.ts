import type { Readable } from "node:stream";

/** Derived source facts only. No standard text, network lookups or conformity claim. */
export type BsiComponentFacts = Readonly<{
  reference: string;
  sourcePath: string;
  creatorContacts: readonly string[];
  name: string | null;
  version: string | null;
  filename: string | null;
  sha512: readonly string[];
  dependencies: readonly string[] | null;
  associatedLicenses: readonly string[];
  concludedLicenses: readonly string[];
  declaredLicenses: readonly string[];
  executable: boolean | null;
  archive: boolean | null;
  structured: boolean | null;
  sourceCodeUris: readonly string[];
  deployableUris: readonly string[];
  identifiers: readonly string[];
  /** Explicit source declaration; null is unknown, never inferred from depth. */
  inDeliveryScope: boolean | null;
  unavailableFields: readonly string[];
  /** Ambiguous native role/reference/classification, distinct from assembly omission. */
  uncertainFields?: readonly string[];
}>;

export type BsiProfileFacts = Readonly<{
  format: "cyclonedx" | "spdx";
  specificationVersion: string;
  documentVersion?: string | null;
  serialization: "json" | "json_ld" | "xml" | "tag_value";
  creatorContacts: readonly string[];
  timestamp: string | null;
  documentUri: string | null;
  primaryComponentReference: string | null;
  embeddedVulnerabilityInformation: boolean;
  externalBomLinks: readonly string[];
  /** Exact native SPDX externalDocumentId declarations with a valid source binding. */
  externalDocumentReferences?: readonly string[];
  components: readonly BsiComponentFacts[];
  /** Extractor limitations/ambiguities retained for manual review, not acceptance. */
  limitations: readonly string[];
}>;

export interface BsiEvidenceReader {
  read(
    orgId: string,
    input: Readonly<{
      reportId: string;
      documentId: string;
      sourceId: string;
      workerId: string;
    }>,
  ): Promise<Readonly<{ facts: BsiProfileFacts; sourceSha256: string }>>;
}

export interface BsiOriginalStorage {
  openVerified(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "verified";
        stream: Readable;
        sha256: string;
        byteSize: number;
        contentType: string;
      }>
    | Readonly<{ outcome: "missing" | "unavailable" }>
  >;
}
export type BsiFactsExtractor = (
  stream: Readable,
  options: Readonly<{
    format: BsiProfileFacts["format"];
    serialization: BsiProfileFacts["serialization"];
    specificationVersion: string;
    maximumBytes?: number;
    maximumComponents?: number;
    onProgress?: (bytes: number) => Promise<void>;
  }>,
) => Promise<BsiProfileFacts>;
