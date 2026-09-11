import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";

import { Version } from "@cyclonedx/cyclonedx-library/Spec";
import { XmlValidator } from "@cyclonedx/cyclonedx-library/Validation";
import type {
  SbomDetectedFormat,
  SbomDetectedSerialization,
  SbomValidationDiagnostic,
  SbomValidationReport,
} from "@repo/contracts/sboms";
import Ajv, {
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv";
import addFormats from "ajv-formats";
import { SaxesParser } from "saxes";

import { parseSpdxTagValue } from "./spdx-tag-value-parser";
import {
  BoundedDiagnosticCollector,
  countDiagnostics,
  DETERMINISTIC_VALIDATION_COMPLETED_AT,
  diagnostic,
  sortDiagnostics,
  VALIDATION_POLICY,
  type SbomValidationPolicy,
} from "./sbom-validation-policy";
import {
  SCHEMA_ASSET_ROOT,
  schemaAssetSha256ForDetection,
  VALIDATOR_NAME,
  VALIDATOR_VERSION,
} from "./schema-manifest";

type SupportedCycloneDxVersion = "1.4" | "1.5" | "1.6";
type SupportedSpdxJsonVersion = "2.2" | "2.3";
type SupportedSpdxVersion = SupportedSpdxJsonVersion | "3.0";

export type ValidateSbomInput = Readonly<{
  bytes: Buffer | Uint8Array;
  fileName?: string;
  mediaType?: string;
  declaredFormat?: "cyclonedx" | "spdx";
  declaredSpecVersion?: string;
}>;

export type CycloneDxXmlValidationProviderResult =
  | readonly SbomValidationDiagnostic[]
  | Readonly<{
      diagnostics: readonly SbomValidationDiagnostic[];
      omittedDiagnosticCount: number;
    }>;

export type CycloneDxXmlValidationProvider = (
  version: SupportedCycloneDxVersion,
  xml: string,
) => Promise<CycloneDxXmlValidationProviderResult>;

export type ValidateSbomOptions = Readonly<{
  policy?: SbomValidationPolicy;
  validateCycloneDxXml?: CycloneDxXmlValidationProvider;
}>;

export class SbomValidationInfrastructureError extends Error {
  constructor(
    readonly code: "validator_unavailable" | "validator_crashed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

type Detection = Readonly<{
  format: SbomDetectedFormat | null;
  serialization: SbomDetectedSerialization | null;
  version: string | null;
}>;

type JsonInspection = Readonly<{
  duplicateCycloneDxBomRefs: readonly string[];
  duplicateSpdxIds: readonly string[];
}>;

let ajvCache: Ajv | null = null;
let schemaValidators: Readonly<Record<string, ValidateFunction>> | null = null;
let spdx3ProfileCache: Readonly<{
  officialContext: string;
  terms: ReadonlySet<string>;
}> | null = null;
const xmlValidatorCache = new Map<SupportedCycloneDxVersion, XmlValidator>();

export async function validateSbom(
  input: ValidateSbomInput,
  options: ValidateSbomOptions = {},
): Promise<SbomValidationReport> {
  const policy = options.policy ?? VALIDATION_POLICY;
  const bytes = Buffer.from(input.bytes);
  if (bytes.length > policy.maximumBytes) {
    return report(
      { format: null, serialization: null, version: null },
      [
        diagnostic(
          "error",
          "byte_limit_exceeded",
          "$",
          "SBOM byte size exceeds the configured validator limit.",
          `Submit an SBOM no larger than ${policy.maximumBytes} bytes.`,
        ),
      ],
      policy,
    );
  }

  const decoded = decodeUtf8(bytes);
  if (decoded.outcome === "invalid") {
    return report(
      { format: null, serialization: null, version: null },
      [decoded.diagnostic],
      policy,
    );
  }

  const text = decoded.text;
  const diagnostics = new BoundedDiagnosticCollector(policy.maximumDiagnostics);
  if (decoded.duplicateBom) {
    diagnostics.push(
      diagnostic(
        "error",
        "duplicate_utf8_bom",
        "$",
        "The input begins with more than one UTF-8 byte order mark.",
        "Submit UTF-8 content with at most one leading BOM.",
      ),
    );
  }

  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return report(
      validateJsonSbom(trimmed, input, policy, diagnostics),
      diagnostics,
      policy,
    );
  }

  if (trimmed.startsWith("<")) {
    return report(
      await validateXmlSbom(
        trimmed,
        input,
        policy,
        options.validateCycloneDxXml ?? defaultCycloneDxXmlValidator,
        diagnostics,
      ),
      diagnostics,
      policy,
    );
  }

  if (/^SPDXVersion:/mu.test(trimmed)) {
    return report(
      validateSpdxTagValueSbom(trimmed, input, policy, diagnostics),
      diagnostics,
      policy,
    );
  }

  diagnostics.push(
    diagnostic(
      "error",
      "unsupported_serialization",
      "$",
      "The SBOM serialization could not be detected from its content.",
      "Submit CycloneDX JSON/XML or SPDX JSON/tag-value content.",
    ),
  );
  return report(
    { format: null, serialization: null, version: null },
    diagnostics,
    policy,
  );
}

function validateJsonSbom(
  text: string,
  input: ValidateSbomInput,
  policy: SbomValidationPolicy,
  diagnostics: BoundedDiagnosticCollector,
): Detection {
  const scannedJsonDiagnostics = scanJsonText(text);
  diagnostics.push(...scannedJsonDiagnostics);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    diagnostics.push(
      diagnostic(
        "error",
        "malformed_json",
        "$",
        "The SBOM is not well-formed JSON.",
        "Submit syntactically valid JSON.",
      ),
    );
    return { format: null, serialization: "json", version: null };
  }

  const inspection = inspectJsonValue(value, policy, diagnostics, {
    skipExtremeNumeric: scannedJsonDiagnostics.some(
      (item) => item.code === "extreme_numeric_literal",
    ),
  });

  const detection = detectJson(value);
  diagnostics.push(...metadataWarnings(input, detection));
  if (hasBlockingSafetyDiagnostic(diagnostics)) {
    return detection;
  }
  if (detection.format === "cyclonedx") {
    validateCycloneDxJson(value, detection.version, diagnostics);
    for (const duplicate of inspection.duplicateCycloneDxBomRefs) {
      diagnostics.push(
        diagnostic(
          "error",
          "duplicate_bom_ref",
          "$",
          `CycloneDX bom-ref '${duplicate}' appears more than once.`,
          "Use unique CycloneDX bom-ref values.",
        ),
      );
    }
  } else if (detection.format === "spdx") {
    validateSpdxJson(value, detection.version, diagnostics);
    for (const duplicate of inspection.duplicateSpdxIds) {
      diagnostics.push(
        diagnostic(
          "error",
          "duplicate_spdx_id",
          "$",
          `SPDX identifier '${duplicate}' appears more than once.`,
          "Use unique SPDX identifiers within the document.",
        ),
      );
    }
  } else {
    diagnostics.push(
      diagnostic(
        "error",
        "unsupported_format",
        "$",
        "The JSON content is neither CycloneDX nor SPDX.",
        "Submit a supported CycloneDX or SPDX SBOM.",
      ),
    );
  }

  return detection;
}

async function validateXmlSbom(
  text: string,
  input: ValidateSbomInput,
  policy: SbomValidationPolicy,
  validateCycloneDxXml: CycloneDxXmlValidationProvider,
  diagnostics: BoundedDiagnosticCollector,
): Promise<Detection> {
  const preflight = preflightXml(text, policy);
  diagnostics.push(...preflight.diagnostics);
  diagnostics.addOmitted(preflight.omittedDiagnosticCount);
  diagnostics.push(...metadataWarnings(input, preflight.detection));
  if (preflight.diagnostics.some((item) => item.severity === "error")) {
    return preflight.detection;
  }

  if (
    preflight.detection.format === "cyclonedx" &&
    isSupportedCycloneDxVersion(preflight.detection.version)
  ) {
    const schemaResult = await validateCycloneDxXml(
      preflight.detection.version,
      text,
    );
    if (isCycloneDxXmlDiagnostics(schemaResult)) {
      diagnostics.push(...schemaResult);
    } else {
      diagnostics.push(...schemaResult.diagnostics);
      diagnostics.addOmitted(schemaResult.omittedDiagnosticCount);
    }
    return preflight.detection;
  }

  diagnostics.push(
    diagnostic(
      "error",
      "unsupported_xml_format",
      "$",
      "Only CycloneDX XML SBOMs are supported.",
      "Submit SPDX SBOMs as JSON or SPDX 2 tag-value.",
    ),
  );
  return preflight.detection;
}

function validateSpdxTagValueSbom(
  text: string,
  input: ValidateSbomInput,
  policy: SbomValidationPolicy,
  diagnostics: BoundedDiagnosticCollector,
): Detection {
  const parsed = parseSpdxTagValue(text, policy.maximumDiagnostics);
  const value: Record<string, unknown> = {
    ...parsed.document,
    packages: parsed.packages,
  };
  diagnostics.push(...parsed.diagnostics);
  diagnostics.addOmitted(parsed.omittedDiagnosticCount);
  const inspection = inspectJsonValue(value, policy, diagnostics);

  const version = spdxVersionString(value["spdxVersion"]);
  const detection: Detection = {
    format: "spdx",
    serialization: "tag_value",
    version,
  };
  diagnostics.push(...metadataWarnings(input, detection));

  if (version === "3.0") {
    diagnostics.push(
      diagnostic(
        "error",
        "unsupported_spdx3_serialization",
        "$",
        "SPDX 3 tag-value serialization is not supported.",
        "Submit SPDX 3 SBOMs as JSON-LD.",
      ),
    );
    return detection;
  }

  if (!hasBlockingSafetyDiagnostic(diagnostics)) {
    validateSpdxJson(value, version, diagnostics);
  }
  for (const duplicate of inspection.duplicateSpdxIds) {
    diagnostics.push(
      diagnostic(
        "error",
        "duplicate_spdx_id",
        "$",
        `SPDX identifier '${duplicate}' appears more than once.`,
        "Use unique SPDX identifiers within the document.",
      ),
    );
  }
  return detection;
}

function validateCycloneDxJson(
  value: unknown,
  version: string | null,
  diagnostics: BoundedDiagnosticCollector,
): void {
  if (!isSupportedCycloneDxVersion(version)) {
    diagnostics.push(versionDiagnostic(version));
    return;
  }
  schemaDiagnostics(
    schemaValidator(`cyclonedx-${version}`),
    value,
    "CycloneDX JSON schema validation failed.",
    diagnostics,
  );
}

function validateSpdxJson(
  value: unknown,
  version: string | null,
  diagnostics: BoundedDiagnosticCollector,
): void {
  if (version === "3.0") {
    validateSpdx3Json(value, diagnostics);
    return;
  }
  if (!isSupportedSpdxJsonVersion(version)) {
    diagnostics.push(versionDiagnostic(version));
    return;
  }
  schemaDiagnostics(
    schemaValidator(`spdx-${version}`),
    value,
    "SPDX JSON schema validation failed.",
    diagnostics,
  );
  if (isRecord(value) && typeof value.documentNamespace !== "string") {
    diagnostics.push(
      diagnostic(
        "error",
        "missing_spdx_namespace",
        "$",
        "SPDX 2 JSON must include documentNamespace.",
        "Add a stable, unique SPDX documentNamespace value.",
      ),
    );
  }
}

function validateSpdx3Json(
  value: unknown,
  diagnostics: BoundedDiagnosticCollector,
): void {
  const profile = spdx3Profile();
  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic(
        "error",
        "missing_spdx3_context",
        "$.@context",
        "SPDX 3 JSON-LD must include an @context.",
        "Include the official SPDX 3 JSON-LD context.",
      ),
    );
    diagnostics.push(
      diagnostic(
        "error",
        "missing_spdx3_graph",
        "$.@graph",
        "SPDX 3 JSON-LD must include an @graph array.",
        "Submit SPDX 3 JSON-LD using the supported package SBOM profile.",
      ),
    );
    return;
  }

  if (value["@context"] !== profile.officialContext) {
    diagnostics.push(
      diagnostic(
        "error",
        "invalid_spdx3_context",
        "$.@context",
        "SPDX 3 JSON-LD must use the pinned official SPDX 3 context.",
        `Use ${profile.officialContext}.`,
      ),
    );
  }
  for (const key of Object.keys(value).sort()) {
    if (key !== "@context" && key !== "@graph") {
      diagnostics.push(spdx3TermDiagnostic(`$.${key}`, key));
    }
  }

  const graphValue = value["@graph"];
  if (!Array.isArray(graphValue) || graphValue.length === 0) {
    diagnostics.push(
      diagnostic(
        "error",
        "missing_spdx3_graph",
        "$.@graph",
        "SPDX 3 JSON-LD must include a non-empty @graph array.",
        "Submit SPDX 3 JSON-LD using the supported package SBOM profile.",
      ),
    );
    diagnostics.push(...missingSpdx3ProfileDiagnostics([]));
    return;
  }

  const graph = graphValue.filter(
    (item, index): item is Record<string, unknown> => {
      if (isRecord(item)) return true;
      diagnostics.push(
        diagnostic(
          "error",
          "invalid_spdx3_graph_item",
          `$.@graph[${index}]`,
          "SPDX 3 JSON-LD graph items must be objects.",
          "Represent each SPDX 3 graph node as a JSON object.",
        ),
      );
      return false;
    },
  );
  graph.forEach((item, index) =>
    validateSpdx3Terms(item, `$.@graph[${index}]`, profile.terms, diagnostics),
  );
  diagnostics.push(...missingSpdx3ProfileDiagnostics(graph));
  spdx3ReferenceDiagnostics(graph, diagnostics);
}

function spdx3Profile(): Readonly<{
  officialContext: string;
  terms: ReadonlySet<string>;
}> {
  if (spdx3ProfileCache === null) {
    const contextAsset = readJsonAsset("spdx/spdx-3.0.context.jsonld");
    const exampleAsset = readJsonAsset(
      "spdx/spdx-3.0.package-sbom.example.json",
    );
    const context = isRecord(contextAsset)
      ? contextAsset["@context"]
      : undefined;
    const terms = isRecord(context)
      ? new Set(Object.keys(context))
      : new Set<string>();
    const officialContext =
      isRecord(exampleAsset) && typeof exampleAsset["@context"] === "string"
        ? exampleAsset["@context"]
        : "https://spdx.org/rdf/3.0.0/spdx-context.jsonld";
    spdx3ProfileCache = Object.freeze({
      officialContext,
      terms,
    });
  }
  return spdx3ProfileCache;
}

function validateSpdx3Terms(
  value: unknown,
  location: string,
  terms: ReadonlySet<string>,
  diagnostics: BoundedDiagnosticCollector,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateSpdx3Terms(item, `${location}[${index}]`, terms, diagnostics),
    );
    return;
  }
  if (!isRecord(value)) return;

  for (const key of Object.keys(value).sort()) {
    if (!isSpdx3JsonLdKeyword(key) && !terms.has(key)) {
      diagnostics.push(spdx3TermDiagnostic(`${location}.${key}`, key));
    }
    validateSpdx3Terms(value[key], `${location}.${key}`, terms, diagnostics);
  }
}

function spdx3TermDiagnostic(
  location: string,
  key: string,
): SbomValidationDiagnostic {
  return diagnostic(
    "error",
    "unsupported_spdx3_term",
    location,
    `SPDX 3 JSON-LD term '${key}' is not present in the pinned local context.`,
    "Use only terms defined by the vendored SPDX 3 JSON-LD context.",
  );
}

function missingSpdx3ProfileDiagnostics(
  graph: readonly Record<string, unknown>[],
): readonly SbomValidationDiagnostic[] {
  const diagnostics: SbomValidationDiagnostic[] = [];
  const creationInfo = graph.find((item) => item.type === "CreationInfo");
  const document = graph.find((item) => item.type === "SpdxDocument");
  const sbom = graph.find((item) => item.type === "software_Sbom");
  const pkg = graph.find((item) => item.type === "software_Package");

  if (
    creationInfo === undefined ||
    spdxVersionString(creationInfo.specVersion) !== "3.0"
  ) {
    diagnostics.push(
      diagnostic(
        "error",
        "missing_spdx3_creation_info",
        "$.@graph",
        "SPDX 3 JSON-LD must include CreationInfo with specVersion 3.0.",
        "Add SPDX 3 CreationInfo metadata.",
      ),
    );
  } else {
    if (typeof creationInfo["@id"] !== "string") {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_creation_info_id",
          "$.@graph",
          "SPDX 3 CreationInfo must include an @id.",
          "Add a stable CreationInfo @id and reference it from graph nodes.",
        ),
      );
    }
    if (typeof creationInfo.created !== "string") {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_created",
          "$.@graph",
          "SPDX 3 CreationInfo must include a created timestamp.",
          "Add a deterministic SPDX 3 created timestamp.",
        ),
      );
    }
    if (!isNonEmptyStringArray(creationInfo.createdBy)) {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_created_by",
          "$.@graph",
          "SPDX 3 CreationInfo must include at least one createdBy reference.",
          "Add at least one createdBy reference.",
        ),
      );
    }
  }

  if (document === undefined) {
    diagnostics.push(
      diagnostic(
        "error",
        "missing_spdx3_document",
        "$.@graph",
        "SPDX 3 JSON-LD must include a SpdxDocument.",
        "Add a SpdxDocument graph node.",
      ),
    );
  } else {
    if (typeof document.spdxId !== "string") {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_document_id",
          "$.@graph",
          "SPDX 3 SpdxDocument must include spdxId.",
          "Add a stable SPDX 3 document spdxId.",
        ),
      );
    }
    if (!isNonEmptyStringArray(document.rootElement)) {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_document_root",
          "$.@graph",
          "SPDX 3 SpdxDocument must include rootElement references.",
          "Reference the SBOM root element from the document.",
        ),
      );
    }
    if (!hasCoreSoftwareProfiles(document.profileConformance)) {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_profile_conformance",
          "$.@graph",
          "SPDX 3 SpdxDocument must declare core and software profile conformance.",
          "Set profileConformance to include core and software.",
        ),
      );
    }
  }

  if (sbom === undefined) {
    diagnostics.push(
      diagnostic(
        "error",
        "missing_spdx3_sbom",
        "$.@graph",
        "SPDX 3 JSON-LD must include a software_Sbom graph node.",
        "Add a software_Sbom graph node for the supported SPDX 3 profile.",
      ),
    );
  } else {
    if (typeof sbom.spdxId !== "string") {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_sbom_id",
          "$.@graph",
          "SPDX 3 software_Sbom must include spdxId.",
          "Add a stable software_Sbom spdxId.",
        ),
      );
    }
    if (!isNonEmptyStringArray(sbom.rootElement)) {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_sbom_root",
          "$.@graph",
          "SPDX 3 software_Sbom must include rootElement references.",
          "Reference package or file elements from the SBOM node.",
        ),
      );
    }
    if (!isNonEmptyStringArray(sbom.software_sbomType)) {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_sbom_type",
          "$.@graph",
          "SPDX 3 software_Sbom must include software_sbomType.",
          "Declare the SPDX 3 SBOM type.",
        ),
      );
    }
  }

  if (pkg === undefined) {
    diagnostics.push(
      diagnostic(
        "error",
        "missing_spdx3_package",
        "$.@graph",
        "SPDX 3 package SBOM profile must include a software_Package.",
        "Add at least one software_Package graph node.",
      ),
    );
  } else {
    if (typeof pkg.spdxId !== "string") {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_package_id",
          "$.@graph",
          "SPDX 3 software_Package must include spdxId.",
          "Add a stable package spdxId.",
        ),
      );
    }
    if (typeof pkg.name !== "string") {
      diagnostics.push(
        diagnostic(
          "error",
          "missing_spdx3_package_name",
          "$.@graph",
          "SPDX 3 software_Package must include name.",
          "Add a package name.",
        ),
      );
    }
  }

  return Object.freeze(diagnostics);
}

function spdx3ReferenceDiagnostics(
  graph: readonly Record<string, unknown>[],
  diagnostics: BoundedDiagnosticCollector,
): void {
  const identifiers = new Set(
    graph.flatMap((item) =>
      [item["@id"], item.spdxId].filter(
        (value): value is string => typeof value === "string",
      ),
    ),
  );
  const creationInfoIds = new Set(
    graph.flatMap((item) =>
      item.type === "CreationInfo" && typeof item["@id"] === "string"
        ? [item["@id"]]
        : [],
    ),
  );
  graph.forEach((item, index) => {
    if (
      item.type !== "CreationInfo" &&
      typeof item.creationInfo === "string" &&
      !creationInfoIds.has(item.creationInfo)
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid_spdx3_creation_info_reference",
          `$.@graph[${index}].creationInfo`,
          "SPDX 3 creationInfo must reference a local CreationInfo @id.",
          "Reference a CreationInfo graph node from each SPDX 3 element.",
        ),
      );
    }
    for (const key of ["rootElement", "createdBy"] as const) {
      const value = item[key];
      if (!Array.isArray(value)) continue;
      value.forEach((reference, referenceIndex) => {
        if (typeof reference === "string" && !identifiers.has(reference)) {
          diagnostics.push(
            diagnostic(
              "error",
              "invalid_spdx3_reference",
              `$.@graph[${index}].${key}[${referenceIndex}]`,
              "SPDX 3 references must point to a local graph identifier.",
              "Reference graph nodes included in the same SPDX 3 JSON-LD document.",
            ),
          );
        }
      });
    }
  });
}

function isSpdx3JsonLdKeyword(key: string): boolean {
  return key === "@id" || key === "type";
}

function isCycloneDxXmlDiagnostics(
  value: CycloneDxXmlValidationProviderResult,
): value is readonly SbomValidationDiagnostic[] {
  return Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string")
  );
}

function hasCoreSoftwareProfiles(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.includes("core") && value.includes("software");
}

function detectJson(value: unknown): Detection {
  if (!isRecord(value)) {
    return { format: null, serialization: "json", version: null };
  }
  if (value.bomFormat === "CycloneDX") {
    return {
      format: "cyclonedx",
      serialization: "json",
      version: stringOrNull(value.specVersion),
    };
  }
  const spdxVersion = spdxVersionString(value.spdxVersion);
  if (spdxVersion !== null) {
    return { format: "spdx", serialization: "json", version: spdxVersion };
  }
  if (
    typeof value["@context"] !== "undefined" ||
    Array.isArray(value["@graph"])
  ) {
    return {
      format: "spdx",
      serialization: "json",
      version: detectSpdx3Version(value),
    };
  }
  return { format: null, serialization: "json", version: null };
}

function detectSpdx3Version(value: Record<string, unknown>): string | null {
  if (
    typeof value["@context"] === "string" &&
    value["@context"] === spdx3Profile().officialContext
  ) {
    return "3.0";
  }
  const graph = Array.isArray(value["@graph"]) ? value["@graph"] : [value];
  for (const item of graph) {
    if (
      isRecord(item) &&
      item.type === "CreationInfo" &&
      spdxVersionString(item.specVersion) === "3.0"
    ) {
      return "3.0";
    }
  }
  return null;
}

function preflightXml(
  text: string,
  policy: SbomValidationPolicy,
): Readonly<{
  detection: Detection;
  diagnostics: readonly SbomValidationDiagnostic[];
  omittedDiagnosticCount: number;
}> {
  const diagnostics = new BoundedDiagnosticCollector(policy.maximumDiagnostics);
  const unsafeChecks: readonly [RegExp, string, string, string][] = [
    [
      /<!DOCTYPE\b/iu,
      "unsafe_xml_doctype",
      "XML doctype declarations are not accepted.",
      "Remove the doctype declaration and submit schema-only XML.",
    ],
    [
      /<!ENTITY\b|&(?!(?:amp|lt|gt|apos|quot);)[A-Za-z_][\w.-]*;/iu,
      "unsafe_xml_entity",
      "XML entity declarations or custom entity references are not accepted.",
      "Remove entity declarations and custom entity references.",
    ],
    [
      /<\?xml-stylesheet\b|<!DOCTYPE\b[^>]*\b(?:SYSTEM|PUBLIC)\b|<!ENTITY\b[^>]*\b(?:SYSTEM|PUBLIC)\b/iu,
      "unsafe_xml_external_resource",
      "XML external resource references are not accepted.",
      "Remove external resource references from the XML.",
    ],
    [
      /\b(?:schemaLocation|noNamespaceSchemaLocation)\s*=/iu,
      "unsafe_xml_schema_location",
      "XML schema-location hints are not accepted.",
      "Remove schema-location hints; CRA uses local schemas only.",
    ],
  ];

  for (const [pattern, code, message, remediation] of unsafeChecks) {
    if (pattern.test(text)) {
      diagnostics.push(diagnostic("error", code, "$", message, remediation));
    }
  }
  if (diagnostics.length > 0) {
    return {
      detection: { format: null, serialization: "xml", version: null },
      diagnostics: diagnostics.toArray(),
      omittedDiagnosticCount: diagnostics.omittedCount,
    };
  }

  let detection: Detection = {
    format: null,
    serialization: "xml",
    version: null,
  };
  let depth = 0;
  let nodes = 0;
  let totalAttributeBytes = 0;
  let rootSeen = false;
  let expectedNamespace: string | null = null;
  let failed = false;
  const parser = new SaxesParser({ xmlns: true });
  const pushUnsafeNamespaceDiagnostic = (
    message: string,
    remediation: string,
  ) => {
    if (diagnostics.some((item) => item.code === "unsafe_xml_namespace")) {
      return;
    }
    diagnostics.push(
      diagnostic("error", "unsafe_xml_namespace", "$", message, remediation),
    );
  };

  parser.on("error", () => {
    if (!failed) {
      failed = true;
      diagnostics.push(
        diagnostic(
          "error",
          "malformed_xml",
          "$",
          "The SBOM is not well-formed XML.",
          "Submit syntactically valid XML.",
        ),
      );
    }
  });
  parser.on("opentag", (node) => {
    nodes += 1;
    depth += 1;
    if (nodes > policy.maximumTokens) {
      diagnostics.push(
        diagnostic(
          "error",
          "token_limit_exceeded",
          "$",
          "XML node count exceeds the configured validator limit.",
          `Submit XML with no more than ${policy.maximumTokens} nodes.`,
        ),
      );
    }
    if (depth > policy.maximumDepth) {
      diagnostics.push(
        diagnostic(
          "error",
          "depth_limit_exceeded",
          "$",
          "XML nesting depth exceeds the configured validator limit.",
          `Submit XML nested no deeper than ${policy.maximumDepth} levels.`,
        ),
      );
    }

    const attributes = Object.values(node.attributes);
    if (attributes.length > policy.maximumAttributesPerElement) {
      diagnostics.push(
        diagnostic(
          "error",
          "attribute_limit_exceeded",
          "$",
          "An XML element has too many attributes.",
          `Use no more than ${policy.maximumAttributesPerElement} attributes per element.`,
        ),
      );
    }
    for (const attribute of attributes) {
      const attributeBytes = Buffer.byteLength(String(attribute.value), "utf8");
      totalAttributeBytes += attributeBytes;
      if (String(attribute.name).startsWith("xmlns:")) {
        pushUnsafeNamespaceDiagnostic(
          "Additional XML namespace declarations are not accepted.",
          "Submit CycloneDX XML with only the CycloneDX default namespace.",
        );
      }
    }
    if (Object.keys(node.ns).some((prefix) => prefix.length > 0)) {
      pushUnsafeNamespaceDiagnostic(
        "Additional XML namespace declarations are not accepted.",
        "Submit CycloneDX XML with only the CycloneDX default namespace.",
      );
    }
    if (totalAttributeBytes > policy.maximumTotalAttributeBytes) {
      diagnostics.push(
        diagnostic(
          "error",
          "attribute_bytes_limit_exceeded",
          "$",
          "Total XML attribute bytes exceed the configured validator limit.",
          `Use no more than ${policy.maximumTotalAttributeBytes} bytes of XML attributes.`,
        ),
      );
    }

    if (!rootSeen) {
      rootSeen = true;
      const version = cycloneDxVersionFromNamespace(node.uri);
      expectedNamespace = version !== null ? node.uri : null;
      detection = {
        format: node.local === "bom" && version !== null ? "cyclonedx" : null,
        serialization: "xml",
        version,
      };
      if (node.local !== "bom" || version === null) {
        diagnostics.push(
          diagnostic(
            "error",
            "unsupported_xml_format",
            "$",
            "The XML root is not a supported CycloneDX BOM.",
            "Submit CycloneDX XML 1.4, 1.5, or 1.6.",
          ),
        );
      } else if (!isSupportedCycloneDxVersion(version)) {
        diagnostics.push(versionDiagnostic(version));
      }
    } else if (
      expectedNamespace !== null &&
      (node.uri !== expectedNamespace || node.prefix.length > 0)
    ) {
      pushUnsafeNamespaceDiagnostic(
        "XML elements must remain in the CycloneDX default namespace.",
        "Remove descendant namespace changes and prefixed XML elements.",
      );
    }
  });
  parser.on("closetag", () => {
    depth -= 1;
  });
  parser.on("text", (value) => {
    if (Buffer.byteLength(value, "utf8") > policy.maximumScalarBytes) {
      diagnostics.push(
        diagnostic(
          "error",
          "scalar_limit_exceeded",
          "$",
          "An XML text value exceeds the configured validator limit.",
          `Use scalar values no larger than ${policy.maximumScalarBytes} bytes.`,
        ),
      );
    }
  });
  parser.write(text).close();

  return {
    detection,
    diagnostics: diagnostics.toArray(),
    omittedDiagnosticCount: diagnostics.omittedCount,
  };
}

async function defaultCycloneDxXmlValidator(
  version: SupportedCycloneDxVersion,
  xml: string,
): Promise<CycloneDxXmlValidationProviderResult> {
  try {
    const validator =
      xmlValidatorCache.get(version) ?? new XmlValidator(versionEnum(version));
    xmlValidatorCache.set(version, validator);
    return collectCycloneDxXmlProviderDiagnostics(
      await validator.validate(xml),
      VALIDATION_POLICY.maximumDiagnostics,
    );
  } catch (error) {
    throw new SbomValidationInfrastructureError(
      "validator_unavailable",
      "CycloneDX XML validator is unavailable.",
      error,
    );
  }
}

function metadataWarnings(
  input: ValidateSbomInput,
  detection: Detection,
): readonly SbomValidationDiagnostic[] {
  const diagnostics: SbomValidationDiagnostic[] = [];
  if (detection.format === null) return diagnostics;
  if (detection.format !== null && input.declaredFormat !== undefined) {
    if (input.declaredFormat !== detection.format) {
      diagnostics.push(
        diagnostic(
          "warning",
          "declared_format_mismatch",
          "$",
          "Declared SBOM format does not match detected content.",
          "Review the declared format metadata; CRA validated the content-detected format.",
        ),
      );
    }
  }
  if (detection.version !== null && input.declaredSpecVersion !== undefined) {
    if (input.declaredSpecVersion !== detection.version) {
      diagnostics.push(
        diagnostic(
          "warning",
          "declared_spec_version_mismatch",
          "$",
          "Declared SBOM spec version does not match detected content.",
          "Review the declared spec version metadata; CRA validated the content-detected version.",
        ),
      );
    }
  }
  if (input.fileName !== undefined && detection.serialization !== null) {
    if (!extensionMatches(input.fileName, detection.serialization)) {
      diagnostics.push(
        diagnostic(
          "warning",
          "extension_mismatch",
          "$",
          "File extension does not match detected SBOM serialization.",
          "Review the filename extension; CRA validated by content.",
        ),
      );
    }
  }
  if (input.mediaType !== undefined && detection.serialization !== null) {
    if (!mediaTypeMatches(input.mediaType, detection)) {
      diagnostics.push(
        diagnostic(
          "warning",
          "media_type_mismatch",
          "$",
          "Declared media type did not match detected SBOM serialization.",
          "Review the media type; CRA validated by content.",
        ),
      );
    }
  }
  return diagnostics;
}

function report(
  detection: Detection,
  diagnostics: BoundedDiagnosticCollector | readonly SbomValidationDiagnostic[],
  policy: SbomValidationPolicy,
): SbomValidationReport {
  const collected =
    diagnostics instanceof BoundedDiagnosticCollector
      ? diagnostics.toArray()
      : diagnostics;
  const sorted = sortDiagnostics(collected);
  const bounded = sorted.slice(0, policy.maximumDiagnostics);
  const counts =
    diagnostics instanceof BoundedDiagnosticCollector
      ? diagnostics.counts
      : countDiagnostics(sorted);
  const status =
    counts.error > 0
      ? "invalid"
      : counts.warning > 0
        ? "valid_with_warnings"
        : "valid";
  const detected =
    detection.format === null ||
    detection.serialization === null ||
    detection.version === null
      ? null
      : {
          format: detection.format,
          serialization: detection.serialization,
          specificationVersion: detection.version,
        };
  return Object.freeze({
    status,
    detected,
    validator: {
      name: VALIDATOR_NAME,
      version: VALIDATOR_VERSION,
      schemaAssetSha256: schemaAssetSha256ForDetection(detection),
    },
    diagnostics: [...bounded],
    errorCount: counts.error,
    warningCount: counts.warning,
    omittedDiagnosticCount:
      (diagnostics instanceof BoundedDiagnosticCollector
        ? diagnostics.omittedCount
        : 0) + Math.max(0, sorted.length - bounded.length),
    completedAt: DETERMINISTIC_VALIDATION_COMPLETED_AT,
  });
}

function decodeUtf8(
  bytes: Buffer,
):
  | Readonly<{ outcome: "valid"; text: string; duplicateBom: boolean }>
  | Readonly<{ outcome: "invalid"; diagnostic: SbomValidationDiagnostic }> {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const text = decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
    return {
      outcome: "valid",
      text,
      duplicateBom: text.startsWith("\uFEFF"),
    };
  } catch {
    return {
      outcome: "invalid",
      diagnostic: diagnostic(
        "error",
        "invalid_utf8",
        "$",
        "SBOM bytes are not valid UTF-8.",
        "Submit UTF-8 encoded JSON, XML, or tag-value content.",
      ),
    };
  }
}

function scanJsonText(text: string): readonly SbomValidationDiagnostic[] {
  const diagnostics: SbomValidationDiagnostic[] = [];
  let index = 0;
  let inString = false;
  let escaped = false;
  while (index < text.length) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (char === "-" || /[0-9]/u.test(char ?? "")) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
        text.slice(index),
      );
      if (match) {
        if (isExtremeNumericLiteral(match[0])) {
          diagnostics.push(
            diagnostic(
              "error",
              "extreme_numeric_literal",
              "$",
              "JSON numeric literal exceeds deterministic validator bounds.",
              "Use bounded integer or decimal values representable by JSON consumers.",
            ),
          );
          return diagnostics;
        }
        index += match[0].length;
        continue;
      }
    }
    index += 1;
  }
  return diagnostics;
}

function inspectJsonValue(
  value: unknown,
  policy: SbomValidationPolicy,
  diagnostics: BoundedDiagnosticCollector,
  options: Readonly<{ skipExtremeNumeric?: boolean }> = {},
): JsonInspection {
  const bomRefs = new Set<string>();
  const duplicateBomRefs = new Set<string>();
  const spdxIds = new Set<string>();
  const duplicateSpdxIds = new Set<string>();
  let nodes = 0;
  const stack: Array<
    Readonly<{ value: unknown; location: string; depth: number }>
  > = [{ value, location: "$", depth: 1 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    nodes += 1;
    if (nodes > policy.maximumTokens) {
      diagnostics.push(
        diagnostic(
          "error",
          "token_limit_exceeded",
          "$",
          "JSON token count exceeds the configured validator limit.",
          `Submit JSON with no more than ${policy.maximumTokens} tokens.`,
        ),
      );
      break;
    }
    if (current.depth > policy.maximumDepth) {
      diagnostics.push(
        diagnostic(
          "error",
          "depth_limit_exceeded",
          current.location,
          "JSON nesting depth exceeds the configured validator limit.",
          `Submit JSON nested no deeper than ${policy.maximumDepth} levels.`,
        ),
      );
    }
    if (typeof current.value === "string") {
      if (
        Buffer.byteLength(current.value, "utf8") > policy.maximumScalarBytes
      ) {
        diagnostics.push(
          diagnostic(
            "error",
            "scalar_limit_exceeded",
            current.location,
            "A JSON scalar value exceeds the configured validator limit.",
            `Use scalar values no larger than ${policy.maximumScalarBytes} bytes.`,
          ),
        );
      }
      continue;
    }
    if (
      typeof current.value === "number" &&
      !Number.isFinite(current.value) &&
      options.skipExtremeNumeric !== true
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "extreme_numeric_literal",
          current.location,
          "JSON numeric literal exceeds deterministic validator bounds.",
          "Use bounded integer or decimal values representable by JSON consumers.",
        ),
      );
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          location: `${current.location}[${index}]`,
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (!isRecord(current.value)) continue;
    for (const key of Object.keys(current.value).sort().reverse()) {
      const child = current.value[key];
      const location = `${current.location}.${key}`;
      if (isPrototypeLikeKey(key)) {
        diagnostics.push(
          diagnostic(
            "error",
            "prototype_key",
            location,
            "JSON contains a prototype-like key.",
            "Remove __proto__, constructor, and prototype keys.",
          ),
        );
      }
      if (key === "bom-ref" && typeof child === "string") {
        if (bomRefs.has(child)) duplicateBomRefs.add(child);
        bomRefs.add(child);
      }
      if ((key === "SPDXID" || key === "spdxId") && typeof child === "string") {
        if (spdxIds.has(child)) duplicateSpdxIds.add(child);
        spdxIds.add(child);
      }
      stack.push({
        value: child,
        location,
        depth: current.depth + 1,
      });
    }
  }

  return Object.freeze({
    duplicateCycloneDxBomRefs: Object.freeze([...duplicateBomRefs].sort()),
    duplicateSpdxIds: Object.freeze([...duplicateSpdxIds].sort()),
  });
}

function schemaValidator(id: string): ValidateFunction {
  if (schemaValidators === null) {
    const ajv = new Ajv({
      // Ajv's error collection is unbounded when allErrors is enabled. CRA
      // needs one stable schema error, not every repeated instance of it.
      allErrors: false,
      formats: { "idn-email": true, "iri-reference": true, iri: true },
      strict: false,
    });
    addFormats(ajv);
    ajv.addSchema(readJsonAsset("cyclonedx/spdx.schema.json") as AnySchema);
    ajv.addSchema(readJsonAsset("cyclonedx/jsf-0.82.schema.json") as AnySchema);
    schemaValidators = Object.freeze({
      "cyclonedx-1.4": ajv.compile(
        readJsonAsset("cyclonedx/bom-1.4.schema.json") as AnySchema,
      ),
      "cyclonedx-1.5": ajv.compile(
        readJsonAsset("cyclonedx/bom-1.5.schema.json") as AnySchema,
      ),
      "cyclonedx-1.6": ajv.compile(
        readJsonAsset("cyclonedx/bom-1.6.schema.json") as AnySchema,
      ),
      "spdx-2.2": ajv.compile(
        readJsonAsset("spdx/spdx-2.2.schema.json") as AnySchema,
      ),
      "spdx-2.3": ajv.compile(
        readJsonAsset("spdx/spdx-2.3.schema.json") as AnySchema,
      ),
    });
    ajvCache = ajv;
  }
  const validator = schemaValidators[id];
  if (validator === undefined) {
    throw new Error(`missing schema validator ${id}`);
  }
  void ajvCache;
  return validator;
}

/**
 * The official XmlValidator currently returns an opaque `ValidationError`
 * value (libxmljs2 supplies an array) and offers no error callback or max
 * error option. Consume it lazily when possible and never normalize it into a
 * second, potentially unbounded array. For indexed sources such as arrays we
 * can truthfully count the entries not retained; an arbitrary iterator has no
 * knowable remainder, so its omitted count remains zero.
 */
export function collectCycloneDxXmlProviderDiagnostics(
  errors: unknown,
  maximumDiagnostics: number,
): Readonly<{
  diagnostics: readonly SbomValidationDiagnostic[];
  omittedDiagnosticCount: number;
}> {
  if (errors === null || errors === undefined) {
    return Object.freeze({ diagnostics: [], omittedDiagnosticCount: 0 });
  }

  const collector = new BoundedDiagnosticCollector(maximumDiagnostics);
  const source = iterableErrors(errors);
  if (source === null) {
    collector.push(xmlSchemaDiagnostic(errors, 0));
    return Object.freeze({
      diagnostics: collector.toArray(),
      omittedDiagnosticCount: collector.omittedCount,
    });
  }

  const knownLength = Array.isArray(errors) ? errors.length : null;
  const iterator = source[Symbol.iterator]();
  let index = 0;
  while (index < maximumDiagnostics) {
    const next = iterator.next();
    if (next.done) break;
    collector.push(xmlSchemaDiagnostic(next.value, index));
    index += 1;
  }
  if (knownLength !== null && knownLength > index) {
    collector.addOmitted(knownLength - index);
  }
  return Object.freeze({
    diagnostics: collector.toArray(),
    omittedDiagnosticCount: collector.omittedCount,
  });
}

function iterableErrors(value: unknown): Iterable<unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    Symbol.iterator in value &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      "function"
    ? (value as Iterable<unknown>)
    : null;
}

function xmlSchemaDiagnostic(
  error: unknown,
  index: number,
): SbomValidationDiagnostic {
  return diagnostic(
    "error",
    "schema_violation",
    xmlErrorLocation(error, index),
    "CycloneDX XML schema validation failed.",
    xmlErrorMessage(error),
  );
}

function schemaDiagnostics(
  validator: ValidateFunction,
  value: unknown,
  message: string,
  diagnostics: BoundedDiagnosticCollector,
): void {
  if (validator(value)) return;
  for (const error of validator.errors ?? []) {
    diagnostics.push(
      diagnostic(
        "error",
        "schema_violation",
        ajvLocation(error),
        message,
        ajvMessage(error),
      ),
    );
  }
}

function readJsonAsset(path: string): unknown {
  return JSON.parse(
    readFileSync(join(SCHEMA_ASSET_ROOT, path), "utf8"),
  ) as unknown;
}

function versionDiagnostic(version: string | null): SbomValidationDiagnostic {
  return version === null
    ? diagnostic(
        "error",
        "missing_spec_version",
        "$",
        "SBOM spec version is missing.",
        "Submit a supported SBOM version.",
      )
    : diagnostic(
        "error",
        "unsupported_spec_version",
        "$",
        `SBOM spec version '${version}' is not supported.`,
        "Submit CycloneDX 1.4, 1.5, 1.6 or SPDX 2.2, 2.3, 3.0 JSON.",
      );
}

function isExtremeNumericLiteral(value: string): boolean {
  const exponent = /[eE]([+-]?\d+)/u.exec(value)?.[1];
  if (exponent !== undefined && Math.abs(Number(exponent)) > 308) return true;
  const integerPart = value.replace(/^-/, "").split(/[.eE]/u)[0] ?? "";
  return integerPart.length > 309;
}

function isPrototypeLikeKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

function hasBlockingSafetyDiagnostic(
  diagnostics: BoundedDiagnosticCollector | readonly SbomValidationDiagnostic[],
): boolean {
  const blockingCodes = new Set([
    "byte_limit_exceeded",
    "depth_limit_exceeded",
    "duplicate_utf8_bom",
    "extreme_numeric_literal",
    "prototype_key",
    "scalar_limit_exceeded",
    "token_limit_exceeded",
  ]);
  return diagnostics.some((item) => blockingCodes.has(item.code));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function spdxVersionString(value: unknown): SupportedSpdxVersion | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/^SPDX-/u, "");
  if (normalized === "2.2" || normalized === "2.3") return normalized;
  if (
    normalized === "3.0" ||
    normalized === "3.0.0" ||
    normalized === "3.0.1"
  ) {
    return "3.0";
  }
  return normalized.length > 0 ? (normalized as SupportedSpdxVersion) : null;
}

function isSupportedCycloneDxVersion(
  version: string | null,
): version is SupportedCycloneDxVersion {
  return version === "1.4" || version === "1.5" || version === "1.6";
}

function isSupportedSpdxJsonVersion(
  version: string | null,
): version is SupportedSpdxJsonVersion {
  return version === "2.2" || version === "2.3";
}

function cycloneDxVersionFromNamespace(uri: string): string | null {
  const match = /^http:\/\/cyclonedx\.org\/schema\/bom\/(1\.\d)$/u.exec(uri);
  return match?.[1] ?? null;
}

function versionEnum(version: SupportedCycloneDxVersion): Version {
  if (version === "1.4") return Version.v1dot4;
  if (version === "1.5") return Version.v1dot5;
  return Version.v1dot6;
}

function extensionMatches(
  fileName: string,
  serialization: SbomDetectedSerialization,
): boolean {
  const lower = fileName.toLowerCase();
  if (serialization === "json") return lower.endsWith(".json");
  if (serialization === "xml") return lower.endsWith(".xml");
  return (
    lower.endsWith(".spdx") || lower.endsWith(".tag") || lower.endsWith(".tv")
  );
}

function mediaTypeMatches(mediaType: string, detection: Detection): boolean {
  const normalized = mediaType.toLowerCase();
  if (normalized === "application/octet-stream") return true;
  if (detection.serialization === "json") {
    if (normalized === "application/json") return true;
    return (
      (detection.format === "cyclonedx" &&
        normalized === "application/vnd.cyclonedx+json") ||
      (detection.format === "spdx" && normalized === "application/spdx+json")
    );
  }
  if (detection.serialization === "xml") {
    if (normalized === "application/xml" || normalized === "text/xml")
      return true;
    return (
      detection.format === "cyclonedx" &&
      normalized === "application/vnd.cyclonedx+xml"
    );
  }
  return normalized === "text/plain";
}

function ajvLocation(error: ErrorObject): string {
  const base = error.instancePath.length === 0 ? "$" : `$${error.instancePath}`;
  if (
    error.keyword === "required" &&
    typeof error.params.missingProperty === "string"
  ) {
    return `${base}.${error.params.missingProperty}`;
  }
  return base;
}

function ajvMessage(error: ErrorObject): string {
  return `Fix schema violation: ${error.message ?? error.keyword}.`;
}

function xmlErrorLocation(error: unknown, index: number): string {
  if (isRecord(error)) {
    const line = typeof error.line === "number" ? error.line : null;
    const column = typeof error.column === "number" ? error.column : null;
    if (line !== null && column !== null)
      return `line:${line}:column:${column}`;
    if (line !== null) return `line:${line}`;
  }
  return `xml-error:${index + 1}`;
}

function xmlErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") {
    return `Fix XML schema violation: ${error.message}`;
  }
  return "Fix XML schema violation.";
}
