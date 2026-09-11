import type { SbomValidationDiagnostic } from "@repo/contracts/sboms";

import {
  BoundedDiagnosticCollector,
  diagnostic,
  VALIDATION_POLICY,
} from "./sbom-validation-policy";

type SpdxJsonObject = Readonly<Record<string, unknown>>;

export type ParsedSpdxTagValue = Readonly<{
  document: SpdxJsonObject;
  packages: readonly SpdxJsonObject[];
  diagnostics: readonly SbomValidationDiagnostic[];
  omittedDiagnosticCount: number;
}>;

const documentTagMap = Object.freeze({
  SPDXVersion: "spdxVersion",
  DataLicense: "dataLicense",
  SPDXID: "SPDXID",
  DocumentName: "name",
  DocumentNamespace: "documentNamespace",
});

const packageTagMap = Object.freeze({
  PackageName: "name",
  SPDXID: "SPDXID",
  PackageDownloadLocation: "downloadLocation",
  FilesAnalyzed: "filesAnalyzed",
  PackageLicenseConcluded: "licenseConcluded",
  PackageLicenseDeclared: "licenseDeclared",
  PackageCopyrightText: "copyrightText",
});

export function parseSpdxTagValue(
  text: string,
  maximumDiagnostics = VALIDATION_POLICY.maximumDiagnostics,
): ParsedSpdxTagValue {
  const diagnostics = new BoundedDiagnosticCollector(maximumDiagnostics);
  let document: Record<string, unknown> = {};
  let creationInfo: Record<string, unknown> = {};
  let currentPackage: Record<string, unknown> | null = null;
  const packages: Record<string, unknown>[] = [];

  const commitPackage = () => {
    if (currentPackage === null) return;
    packages.push(Object.freeze({ ...currentPackage }));
    currentPackage = null;
  };

  const duplicateDiagnostics = (
    key: string,
    tag: string,
    lineNumber: number,
  ): readonly SbomValidationDiagnostic[] =>
    key === "SPDXID"
      ? [
          diagnostic(
            "error",
            "duplicate_spdx_tag",
            `line:${lineNumber}`,
            `SPDX tag '${tag}' appears more than once in the same section.`,
            "Keep only one value for each singleton SPDX tag in a section.",
          ),
          diagnostic(
            "error",
            "duplicate_spdx_id",
            `line:${lineNumber}`,
            "An SPDX identifier tag appears more than once in the same section.",
            "Use a single unique SPDXID per document or package section.",
          ),
        ]
      : [
          diagnostic(
            "error",
            "duplicate_spdx_tag",
            `line:${lineNumber}`,
            `SPDX tag '${tag}' appears more than once in the same section.`,
            "Keep only one value for each singleton SPDX tag in a section.",
          ),
        ];

  const assignSingleton = (
    target: Record<string, unknown>,
    key: string,
    tag: string,
    value: unknown,
    lineNumber: number,
  ): Record<string, unknown> => {
    if (Object.hasOwn(target, key)) {
      diagnostics.push(...duplicateDiagnostics(key, tag, lineNumber));
      return target;
    }
    return { ...target, [key]: value };
  };

  text.split(/\r?\n/u).forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf(":");
    if (separator < 1) {
      diagnostics.push(
        diagnostic(
          "error",
          "malformed_tag_value_line",
          `line:${lineNumber}`,
          "SPDX tag-value lines must use `Tag: value` syntax.",
          "Submit well-formed SPDX tag-value content.",
        ),
      );
      return;
    }

    const tag = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (tag === "PackageName") {
      commitPackage();
      currentPackage = { name: value };
      return;
    }

    if (tag === "Creator") {
      const creators = asStringArray(creationInfo.creators);
      creationInfo = {
        ...creationInfo,
        creators: Object.freeze([...creators, value]),
      };
      return;
    }

    if (tag === "Created") {
      creationInfo = assignSingleton(
        creationInfo,
        "created",
        tag,
        value,
        lineNumber,
      );
      return;
    }

    const packageKey =
      packageTagMap[tag as keyof typeof packageTagMap] ?? undefined;
    if (currentPackage !== null && packageKey !== undefined) {
      currentPackage = assignSingleton(
        currentPackage,
        packageKey,
        tag,
        packageValue(packageKey, value),
        lineNumber,
      );
      return;
    }

    const documentKey =
      documentTagMap[tag as keyof typeof documentTagMap] ?? undefined;
    if (documentKey !== undefined) {
      document = assignSingleton(document, documentKey, tag, value, lineNumber);
    }
  });

  commitPackage();
  return Object.freeze({
    document: Object.freeze({
      ...document,
      creationInfo: Object.freeze({ ...creationInfo }),
    }),
    packages: Object.freeze(packages),
    diagnostics: diagnostics.toArray(),
    omittedDiagnosticCount: diagnostics.omittedCount,
  });
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function packageValue(key: string, value: string): string | boolean {
  if (key === "filesAnalyzed") return value.toLowerCase() === "true";
  return value;
}
