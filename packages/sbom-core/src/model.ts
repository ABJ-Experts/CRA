// Normalised SBOM model — the internal representation every parser produces
// (FR-SBOM-007). The byte-exact original is the evidence; this is only an index.

export type SbomFormat = "cyclonedx" | "spdx";

/** Comparator ecosystem keys (the version-comparison Strategy chooses by this). */
export type Ecosystem = "semver" | "deb" | "rpm" | "maven" | "pep440" | "go";

export type ComponentScope = "required" | "optional" | "excluded";

export interface NormalizedComponent {
  /** Package URL — the precise matching key we want wherever it exists. */
  purl: string | null;
  /** CPE fallback (OS/firmware components). */
  cpe: string | null;
  name: string;
  version: string | null;
  /** Resolved comparator ecosystem, or null when unknown. */
  ecosystem: Ecosystem | null;
  /** Canonical version computed once at ingest — never at query time. */
  versionNormalised: string | null;
  /** 0 = top-level dependency (the CRA floor). */
  depth: number;
  scope: ComponentScope | null;
  supplierName: string | null;
  hashes: Record<string, string>;
}

export interface ParsedSbom {
  format: SbomFormat;
  specVersion: string;
  serialNumber: string | null;
  components: NormalizedComponent[];
  componentCount: number;
  depthMax: number;
}

// Adapter: one implementation per SBOM format.
export interface SbomParser {
  readonly format: SbomFormat;
  parse(raw: string): ParsedSbom;
}

export class SbomParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SbomParseError";
  }
}
