// @repo/sbom-core — SBOM parsing + normalisation + version comparators.
export * from "./model";
export * from "./purl";
export * from "./package-identity";
export { comparatorFor, type VersionComparator } from "./comparators";
export * from "./matching";
export { CycloneDxParser, SpdxParser } from "./parsers";
// The golden accuracy dataset (FR-MATCH-005). Exported because apps/api runs the
// same corpus through the DB-backed adapter — see src/golden/index.ts.
export * from "./golden";

import { CycloneDxParser, SpdxParser } from "./parsers";
import {
  SbomParseError,
  type ParsedSbom,
  type SbomFormat,
  type SbomParser,
} from "./model";

/** Sniff a raw document to determine its SBOM format (JSON only in MVP). */
export function detectFormat(raw: string): SbomFormat | null {
  if (!raw.trimStart().startsWith("{")) return null;
  try {
    const doc = JSON.parse(raw) as { bomFormat?: string; spdxVersion?: string };
    if (doc.bomFormat === "CycloneDX") return "cyclonedx";
    if (
      typeof doc.spdxVersion === "string" &&
      doc.spdxVersion.startsWith("SPDX-")
    ) {
      return "spdx";
    }
  } catch {
    return null;
  }
  return null;
}

// Abstract Factory: pick the parser Adapter by format.
export function parserFor(format: SbomFormat): SbomParser {
  switch (format) {
    case "cyclonedx":
      return new CycloneDxParser();
    case "spdx":
      return new SpdxParser();
  }
}

export function parseSbom(raw: string): ParsedSbom {
  const format = detectFormat(raw);
  if (!format) {
    throw new SbomParseError(
      "Unrecognised SBOM format (expected CycloneDX or SPDX JSON)",
    );
  }
  return parserFor(format).parse(raw);
}
