import { createHash } from "node:crypto";

import {
  validateVexExport,
  type VexExportFormat,
  type VexValidationResult,
} from "./vex-export-validation";

type AssessmentStatus =
  "under_investigation" | "affected" | "not_affected" | "fixed";
type AssessmentJustification =
  | "component_not_present"
  | "vulnerable_code_not_present"
  | "vulnerable_code_not_in_execute_path"
  | "vulnerable_code_cannot_be_controlled_by_adversary"
  | "inline_mitigations_already_exist";

export type VexAssessmentExportRecord = Readonly<{
  findingId: string;
  assessmentId: string;
  revision: number;
  advisoryId: string;
  canonicalPurl: string | null;
  componentVersion: string | null;
  status: AssessmentStatus;
  justification: AssessmentJustification | null;
  /** Effective approval state returned by the locked export scope. */
  approvalState: "approved" | "approval_not_required";
  effectiveAt: string;
  /** A stable revision reference, never free-text assessment detail. */
  provenanceReference: string | null;
  /** Deliberately accepted but never read: repositories may carry private data. */
  detail?: string;
  evidenceLinks?: readonly string[];
}>;

export type GenerateVexExportInput = Readonly<{
  format: VexExportFormat;
  snapshotId: string;
  generatedAt: string;
  product: Readonly<{ id: string; name: string }>;
  release: Readonly<{ id: string; label: string }>;
  assessments: readonly VexAssessmentExportRecord[];
}>;

export type GeneratedVexExport = Readonly<{
  format: VexExportFormat;
  specificationVersion: "0.2.0" | "1.6";
  mediaType: "application/vnd.openvex+json" | "application/vnd.cyclonedx+json";
  bytes: Buffer;
  sha256: string;
  document: Readonly<Record<string, unknown>>;
  validation: VexValidationResult;
}>;

export class VexExportMappingError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const exactCycloneDxJustifications = Object.freeze({
  component_not_present: "code_not_present",
  vulnerable_code_not_present: "code_not_present",
  vulnerable_code_not_in_execute_path: "code_not_reachable",
} as const);

/**
 * Builds a reproducible public VEX document exclusively from already-effective
 * assessment revisions. This pure boundary intentionally has no clock, DB, or
 * storage dependency: callers persist the exact returned bytes atomically with
 * their snapshot evidence.
 */
export function generateVexExport(
  input: GenerateVexExportInput,
): GeneratedVexExport {
  if (input.assessments.length === 0) {
    throw new VexExportMappingError(
      "At least one eligible assessment is required for VEX export.",
    );
  }

  const generatedAt = utc(input.generatedAt, "generated timestamp");
  const records = input.assessments.map(normalizeRecord).sort(compareRecords);
  const document =
    input.format === "openvex"
      ? openVexDocument(input, records, generatedAt)
      : cycloneDxDocument(input, records, generatedAt);
  const validation = validateVexExport(input.format, document);
  const bytes = Buffer.from(`${canonicalJson(document)}\n`, "utf8");

  return Object.freeze({
    format: input.format,
    specificationVersion: input.format === "openvex" ? "0.2.0" : "1.6",
    mediaType:
      input.format === "openvex"
        ? "application/vnd.openvex+json"
        : "application/vnd.cyclonedx+json",
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    document,
    validation,
  });
}

type NormalizedRecord = Readonly<
  Omit<
    VexAssessmentExportRecord,
    "effectiveAt" | "canonicalPurl" | "componentVersion"
  > & {
    effectiveAt: string;
    componentPurl: string;
    componentVersion: string;
  }
>;

function normalizeRecord(record: VexAssessmentExportRecord): NormalizedRecord {
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    throw new VexExportMappingError(
      "Assessment revisions must be positive integers.",
    );
  }
  if (!record.advisoryId.trim()) {
    throw new VexExportMappingError(
      "Eligible assessments require a stable advisory identifier.",
    );
  }
  if (!record.canonicalPurl?.trim() || !record.componentVersion?.trim()) {
    throw new VexExportMappingError(
      "Eligible assessments require a stable component identifier and version.",
    );
  }
  const purl = exactPurl(record.canonicalPurl, record.componentVersion);
  return Object.freeze({
    ...record,
    componentPurl: purl,
    componentVersion: record.componentVersion,
    effectiveAt: utc(record.effectiveAt, "assessment effective timestamp"),
  });
}

function openVexDocument(
  input: GenerateVexExportInput,
  records: readonly NormalizedRecord[],
  generatedAt: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    "@context": "https://openvex.dev/ns/v0.2.0",
    "@id": `urn:cra:vex:export:${input.snapshotId}`,
    author: "CRA",
    timestamp: generatedAt,
    version: 1,
    statements: records.map((record) =>
      compact({
        "@id": statementReference(record),
        version: record.revision,
        vulnerability: { name: record.advisoryId },
        products: [{ "@id": record.componentPurl }],
        status: record.status,
        justification: record.justification ?? undefined,
        // OpenVEX requires an action statement for affected findings. This is
        // intentionally fixed public wording, not private assessment detail.
        action_statement:
          record.status === "affected"
            ? "Remediation is tracked by the product owner."
            : undefined,
        timestamp: record.effectiveAt,
      }),
    ),
  });
}

function cycloneDxDocument(
  input: GenerateVexExportInput,
  records: readonly NormalizedRecord[],
  generatedAt: string,
): Readonly<Record<string, unknown>> {
  const components = uniqueComponents(records);
  return Object.freeze({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${input.snapshotId}`,
    version: 1,
    metadata: { timestamp: generatedAt },
    components,
    vulnerabilities: records.map((record) => {
      const analysis = cycloneDxAnalysis(record);
      return compact({
        "bom-ref": statementReference(record),
        id: record.advisoryId,
        affects: [{ ref: record.componentPurl }],
        analysis: {
          ...analysis,
          firstIssued: record.effectiveAt,
          lastUpdated: record.effectiveAt,
        },
      });
    }),
  });
}

function cycloneDxAnalysis(
  record: NormalizedRecord,
): Readonly<Record<string, string>> {
  if (record.status === "under_investigation") return { state: "in_triage" };
  if (record.status === "fixed") return { state: "resolved" };
  if (record.status === "affected") {
    throw new VexExportMappingError(
      "CycloneDX VEX export cannot represent an affected assessment without a lossy mapping.",
    );
  }
  const justification = record.justification;
  if (!justification || !(justification in exactCycloneDxJustifications)) {
    throw new VexExportMappingError(
      "CycloneDX VEX export cannot represent this not-affected justification without a lossy mapping.",
    );
  }
  return {
    state: "not_affected",
    justification:
      exactCycloneDxJustifications[
        justification as keyof typeof exactCycloneDxJustifications
      ],
  };
}

function uniqueComponents(records: readonly NormalizedRecord[]) {
  const components = new Map<string, Readonly<Record<string, string>>>();
  for (const record of records) {
    components.set(
      record.componentPurl,
      Object.freeze({
        type: "library",
        "bom-ref": record.componentPurl,
        name: componentName(record.componentPurl),
        version: record.componentVersion ?? "",
        purl: record.componentPurl,
      }),
    );
  }
  return [...components.values()].sort((left, right) =>
    String(left["bom-ref"]).localeCompare(String(right["bom-ref"])),
  );
}

function statementReference(record: NormalizedRecord): string {
  const reference = record.provenanceReference?.trim();
  if (reference && /^[a-zA-Z0-9._:-]+$/u.test(reference)) {
    return `urn:cra:vex:${reference}`;
  }
  return `urn:cra:vex:assessment:${record.assessmentId}:revision:${record.revision}`;
}

function exactPurl(canonicalPurl: string, version: string): string {
  const trimmed = canonicalPurl.trim();
  if (!trimmed.startsWith("pkg:") || /\s/u.test(trimmed)) {
    throw new VexExportMappingError(
      "Component identifiers must be canonical package URLs.",
    );
  }
  return /@[^/?#]+(?:[?#].*)?$/u.test(trimmed)
    ? trimmed
    : `${trimmed}@${encodeURIComponent(version.trim())}`;
}

function componentName(purl: string): string {
  const withoutQualifiers = purl.split(/[?#]/u, 1)[0] ?? purl;
  const name = withoutQualifiers.slice(withoutQualifiers.lastIndexOf("/") + 1);
  const at = name.lastIndexOf("@");
  return decodeURIComponent(at > 0 ? name.slice(0, at) : name) || "component";
}

function utc(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new VexExportMappingError(`Invalid ${label}.`);
  }
  return date.toISOString();
}

function compareRecords(
  left: NormalizedRecord,
  right: NormalizedRecord,
): number {
  return (
    [
      left.advisoryId.localeCompare(right.advisoryId),
      left.componentPurl.localeCompare(right.componentPurl),
      left.assessmentId.localeCompare(right.assessmentId),
      left.revision - right.revision,
    ].find((result) => result !== 0) ?? 0
  );
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
