import { createHash } from "node:crypto";
import { z } from "zod";
import {
  sbomExportResponseSchema,
  type SbomExportQuery,
  type SbomExportResponse,
} from "@repo/contracts/sboms";
import {
  generateVexExport,
  VexExportMappingError,
  type VexAssessmentExportRecord,
} from "../../findings/exports/vex-export-generator";
import { validateSbom } from "../validation/sbom-validator";

export type SbomExportComponent = Readonly<{
  id: string;
  name: string;
  version: string | null;
  purl: string | null;
  cpe: string | null;
  supplier: string | null;
  license: string | null;
  hashes: readonly Readonly<{ algorithm: string; value: string }>[];
}>;
export type SbomExportGraph = Readonly<{
  documentId: string;
  sourceId: string;
  productId: string;
  releaseId: string;
  createdAt: string;
  components: readonly SbomExportComponent[];
  dependencies: readonly Readonly<{ parentId: string; childId: string }>[];
}>;
export class SbomExportConflict extends Error {}

/** Portable normalized projection. JSON escaping keeps text inert; no original is rewritten. */
export async function serializeSbomExport(
  graph: SbomExportGraph,
  query: SbomExportQuery,
  assessments: readonly VexAssessmentExportRecord[],
): Promise<SbomExportResponse> {
  if (graph.components.length > 50_000 || graph.dependencies.length > 250_000)
    throw new SbomExportConflict(
      "The normalized graph exceeds the bounded export ceiling.",
    );
  const ids = new Set(graph.components.map((component) => component.id));
  if (
    ids.size !== graph.components.length ||
    graph.dependencies.some(
      (edge) => !ids.has(edge.parentId) || !ids.has(edge.childId),
    )
  )
    throw new SbomExportConflict(
      "Unresolved graph references cannot be silently exported.",
    );
  if (query.includeVex && assessments.length === 0)
    throw new SbomExportConflict(
      "No reviewed effective VEX assessments are available for this release.",
    );
  if (query.includeVex && query.format !== "cyclonedx")
    throw new SbomExportConflict("SPDX 2.3 cannot embed native VEX.");
  const components = [...graph.components].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const baseDocument =
    query.format === "cyclonedx"
      ? cycloneDx(graph, components)
      : spdx(graph, components);
  const document = query.includeVex
    ? embedVex(graph, components, baseDocument, assessments)
    : baseDocument;
  const content = `${JSON.stringify(document)}\n`;
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength > 50 * 1024 * 1024)
    throw new SbomExportConflict("The serialized export exceeds 50 MiB.");
  const validation = await validateSbom({
    bytes,
    declaredFormat: query.format,
    declaredSpecVersion: query.format === "cyclonedx" ? "1.6" : "2.3",
  });
  if (validation.status === "invalid")
    throw new SbomExportConflict(
      "Normalized fields cannot be represented by the selected format; download the original instead.",
    );
  return sbomExportResponseSchema.parse({
    export: {
      documentId: graph.documentId,
      sourceId: graph.sourceId,
      format: query.format,
      specificationVersion: query.format === "cyclonedx" ? "1.6" : "2.3",
      fileName: `sbom-${graph.documentId}.${query.format === "cyclonedx" ? "cdx" : "spdx"}.json`,
      mediaType:
        query.format === "cyclonedx"
          ? "application/vnd.cyclonedx+json"
          : "application/spdx+json",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      content,
      vex: {
        status: query.includeVex ? "included" : "not_requested",
        assessmentCount: query.includeVex ? assessments.length : 0,
      },
    },
  });
}
function embedVex(
  graph: SbomExportGraph,
  components: readonly SbomExportComponent[],
  document: Record<string, unknown>,
  assessments: readonly VexAssessmentExportRecord[],
): Record<string, unknown> {
  const byPurl = new Map<string, string[]>();
  for (const component of components)
    if (component.purl)
      byPurl.set(component.purl, [
        ...(byPurl.get(component.purl) ?? []),
        component.id,
      ]);
  if (
    assessments.some(
      (record) => !record.canonicalPurl || !byPurl.has(record.canonicalPurl),
    )
  )
    throw new SbomExportConflict(
      "Reviewed VEX references components absent from this exact SBOM.",
    );
  const vex = reviewedVexDocument({
    format: "cyclonedx-vex",
    snapshotId: graph.documentId,
    generatedAt: graph.createdAt,
    product: { id: graph.productId, name: "Normalized SBOM" },
    release: { id: graph.releaseId, label: graph.releaseId },
    assessments,
  });
  const vulnerabilities = vex.document.vulnerabilities;
  if (!Array.isArray(vulnerabilities))
    throw new SbomExportConflict(
      "Reviewed VEX cannot be represented in this export.",
    );
  return {
    ...document,
    vulnerabilities: vulnerabilities.map((item) => {
      const record = z
        .object({ affects: z.array(z.object({ ref: z.string() })) })
        .passthrough()
        .parse(item);
      return {
        ...record,
        affects: record.affects.flatMap((affected) => {
          const matched = byPurl.get(affected.ref);
          if (!matched?.length)
            throw new SbomExportConflict(
              "Reviewed VEX cannot be bound to this exact SBOM component identity.",
            );
          return matched.map((id) => ({ ref: `urn:uuid:${id}` }));
        }),
      };
    }),
  };
}

function cycloneDx(
  graph: SbomExportGraph,
  components: readonly SbomExportComponent[],
): Record<string, unknown> {
  const dependencies = new Map<string, string[]>();
  for (const edge of graph.dependencies)
    dependencies.set(edge.parentId, [
      ...(dependencies.get(edge.parentId) ?? []),
      edge.childId,
    ]);
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${graph.documentId}`,
    version: 1,
    metadata: { timestamp: graph.createdAt },
    components: components.map((component) => ({
      type: "library",
      "bom-ref": `urn:uuid:${component.id}`,
      name: component.name,
      ...(component.version ? { version: component.version } : {}),
      ...(component.purl ? { purl: component.purl } : {}),
      ...(component.cpe ? { cpe: component.cpe } : {}),
      ...(component.supplier ? { supplier: { name: component.supplier } } : {}),
      ...(component.license
        ? { licenses: [{ expression: component.license }] }
        : {}),
      ...(component.hashes.length
        ? {
            hashes: component.hashes.map((hash) => ({
              alg: cycloneDxHashAlgorithm(hash.algorithm),
              content: hash.value,
            })),
          }
        : {}),
    })),
    dependencies: [...dependencies]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, children]) => ({
        ref: `urn:uuid:${id}`,
        dependsOn: [...new Set(children)]
          .sort()
          .map((child) => `urn:uuid:${child}`),
      })),
  };
}
function spdx(
  graph: SbomExportGraph,
  components: readonly SbomExportComponent[],
): Record<string, unknown> {
  const reference = (id: string) => `SPDXRef-${id}`;
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `Normalized SBOM ${graph.documentId}`,
    documentNamespace: `https://cra.invalid/sbom/${graph.documentId}/${graph.sourceId}`,
    creationInfo: {
      created: graph.createdAt,
      creators: ["Tool: CRA normalized export"],
    },
    packages: components.map((component) => ({
      SPDXID: reference(component.id),
      name: component.name,
      ...(component.version ? { versionInfo: component.version } : {}),
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: component.license ?? "NOASSERTION",
      copyrightText: "NOASSERTION",
      ...(component.supplier
        ? {
            supplier:
              /^(Person|Organization):/u.test(component.supplier) ||
              component.supplier === "NOASSERTION"
                ? component.supplier
                : `Organization: ${component.supplier}`,
          }
        : {}),
      ...(component.purl || component.cpe
        ? {
            externalRefs: [
              ...(component.cpe
                ? [
                    {
                      referenceCategory: "SECURITY",
                      referenceType: "cpe23Type",
                      referenceLocator: component.cpe,
                    },
                  ]
                : []),
              ...(component.purl
                ? [
                    {
                      referenceCategory: "PACKAGE-MANAGER",
                      referenceType: "purl",
                      referenceLocator: component.purl,
                    },
                  ]
                : []),
            ],
          }
        : {}),
      ...(component.hashes.length
        ? {
            checksums: component.hashes.map((hash) => ({
              algorithm: spdxHashAlgorithm(hash.algorithm),
              checksumValue: hash.value,
            })),
          }
        : {}),
    })),
    relationships: [
      ...components.map((component) => ({
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: reference(component.id),
      })),
      ...graph.dependencies.map((edge) => ({
        spdxElementId: reference(edge.parentId),
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: reference(edge.childId),
      })),
    ],
  };
}

function cycloneDxHashAlgorithm(value: string): string {
  return value.replace(/^SHA(1|224|256|384|512)$/u, "SHA-$1");
}
function spdxHashAlgorithm(value: string): string {
  return value.replace(/^SHA-(1|224|256|384|512)$/u, "SHA$1");
}

function reviewedVexDocument(
  input: Parameters<typeof generateVexExport>[0],
): ReturnType<typeof generateVexExport> {
  try {
    return generateVexExport(input);
  } catch (error) {
    if (error instanceof VexExportMappingError)
      throw new SbomExportConflict(error.message);
    throw error;
  }
}
