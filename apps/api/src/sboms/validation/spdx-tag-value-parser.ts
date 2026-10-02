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
  PackageVersion: "versionInfo",
  PackageSupplier: "supplier",
  PackageOriginator: "originator",
  PackageHomePage: "homepage",
  PackageSummary: "summary",
  PackageDescription: "description",
  PackageSourceInfo: "sourceInfo",
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

  Array.from(logicalSpdxLines(text)).forEach(([line, index]) => {
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

    if (tag === "Relationship") {
      const match = value.match(/^(\S+)\s+(\S+)\s+(\S+)(?:\s+#.*)?$/u);
      if (match)
        document = {
          ...document,
          relationships: [
            ...asArray(document.relationships),
            {
              spdxElementId: match[1],
              relationshipType: match[2],
              relatedSpdxElement: match[3],
            },
          ],
        };
      else
        diagnostics.push(
          diagnostic(
            "error",
            "malformed_tag_value_line",
            `line:${lineNumber}`,
            "Malformed SPDX relationship.",
            "Use an SPDX relationship triplet.",
          ),
        );
      return;
    }
    if (currentPackage !== null && tag === "ExternalRef") {
      const match = value.match(/^(\S+)\s+(\S+)\s+(.+)$/u);
      if (match)
        currentPackage = {
          ...currentPackage,
          externalRefs: [
            ...asArray(currentPackage.externalRefs),
            {
              referenceCategory: match[1],
              referenceType: match[2],
              referenceLocator: match[3],
            },
          ],
        };
      else
        diagnostics.push(
          diagnostic(
            "error",
            "malformed_tag_value_line",
            `line:${lineNumber}`,
            "Malformed SPDX external reference.",
            "Use category, type and locator.",
          ),
        );
      return;
    }
    if (currentPackage !== null && tag === "PackageChecksum") {
      const match = value.match(/^([^:]+):\s*(\S+)$/u);
      if (match)
        currentPackage = {
          ...currentPackage,
          checksums: [
            ...asArray(currentPackage.checksums),
            { algorithm: match[1], checksumValue: match[2] },
          ],
        };
      else
        diagnostics.push(
          diagnostic(
            "error",
            "malformed_tag_value_line",
            `line:${lineNumber}`,
            "Malformed SPDX checksum.",
            "Use algorithm and checksum value.",
          ),
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

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function* logicalSpdxLines(text: string): Generator<readonly [string, number]> {
  let pending = "";
  let firstLine = 0;
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (pending) {
      pending += `\n${line}`;
      if (line.includes("</text>")) {
        yield [pending.replace("<text>", "").replace("</text>", ""), firstLine];
        pending = "";
      }
    } else if (line.includes("<text>")) {
      if (line.includes("</text>"))
        yield [line.replace("<text>", "").replace("</text>", ""), index];
      else {
        pending = line;
        firstLine = index;
      }
    } else yield [line, index];
  }
  if (pending) yield ["Unterminated SPDX text block", firstLine];
}
