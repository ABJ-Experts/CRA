// @repo/sbom-core — SBOM parsing + normalisation + version comparators.
export * from "./model";
export * from "./purl";
export * from "./package-identity";
export { comparatorFor, type VersionComparator } from "./comparators";
export * from "./matching";
export { CycloneDxParser, CycloneDxXmlParser, SpdxParser, SpdxTagValueParser } from "./parsers";
// The golden accuracy dataset (FR-MATCH-005). Exported because apps/api runs the
// same corpus through the DB-backed adapter — see src/golden/index.ts.
export * from "./golden";

import { CycloneDxParser, CycloneDxXmlParser, SpdxParser, SpdxTagValueParser } from "./parsers";
import { SbomParseError, type ParsedSbom, type SbomFormat, type SbomParser } from "./model";

/** Sniff a BRD-supported JSON, XML, or SPDX tag-value document. */
export function detectFormat(raw: string): SbomFormat | null {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<bom")) {
    return /<bom(?:\s|>)/.test(trimmed) ? "cyclonedx" : null;
  }
  if (/^SPDXVersion:\s*SPDX-/m.test(trimmed)) return "spdx";
  if (!trimmed.startsWith("{")) return null;
  try {
    const doc = JSON.parse(raw) as { bomFormat?: string; spdxVersion?: string };
    if (doc.bomFormat === "CycloneDX") return "cyclonedx";
    if (typeof doc.spdxVersion === "string" && doc.spdxVersion.startsWith("SPDX-")) {
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
      "Unrecognised SBOM format (expected CycloneDX JSON/XML or SPDX JSON/tag-value)",
    );
  }
  const trimmed = raw.trimStart();
  if (format === "cyclonedx" && (trimmed.startsWith("<?xml") || trimmed.startsWith("<bom"))) {
    return new CycloneDxXmlParser().parse(raw);
  }
  if (format === "spdx" && /^SPDXVersion:/m.test(trimmed)) {
    return new SpdxTagValueParser().parse(raw);
  }
  return parserFor(format).parse(raw);
}
