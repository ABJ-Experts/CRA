import { describe, expect, it } from "vitest";

import {
  sbomComponentSearchQuerySchema,
  sbomComponentSearchResponseSchema,
  sbomDependencyTreeQuerySchema,
  sbomDocumentDetailResponseSchema,
  sbomDocumentListResponseSchema,
} from "./sbom-normalization.schema.js";

const documentId = "00000000-0000-4000-8000-000000000001";
const componentId = "00000000-0000-4000-8000-000000000002";
const sourceId = "00000000-0000-4000-8000-000000000003";
const now = "2026-08-24T00:00:00.000Z";

const document = Object.freeze({
  id: documentId,
  sourceId,
  format: "cyclonedx",
  specificationVersion: "1.6",
  parser: { name: "CRA streaming SBOM parser", version: "1.0.0" },
  normalizer: { name: "CRA SBOM normalizer", version: "1.0.0" },
  state: "completed",
  validationStatus: "valid_with_warnings",
  componentCount: 1,
  dependencyCount: 0,
  maximumDepth: 0,
  warningCount: 1,
  error: null,
  completedAt: now,
  createdAt: now,
  updatedAt: now,
});

describe("SBOM normalization contracts", () => {
  it("parses tenant-safe document, component, and tree responses", () => {
    expect(
      sbomDocumentDetailResponseSchema.parse({
        document,
        diagnostics: [
          {
            severity: "warning",
            code: "invalid_purl",
            location: "/components/0/purl",
            message: "The supplied PURL was not valid.",
            sourceByteStart: 42,
            sourceByteEnd: 57,
          },
        ],
      }),
    ).toMatchObject({ document: { id: documentId } });
    const parsedComponents = sbomComponentSearchResponseSchema.parse({
      components: [
        {
          id: componentId,
          documentId,
          documentLocalRef: "pkg:npm/example@1.0.0",
          originalName: "Example",
          normalizedName: "example",
          originalVersion: "1.0.0",
          normalizedVersion: "1.0.0",
          originalPurl: "pkg:npm/example@1.0.0",
          canonicalPurl: "pkg:npm/example@1.0.0",
          cpe: null,
          ecosystem: "npm",
          scope: null,
          supplier: null,
          licenseExpression: null,
          hashes: [],
          depth: 0,
          parentComponentId: null,
          sourceLocation: {
            path: "/components/0",
            byteStart: 0,
            byteEnd: 120,
            line: 1,
          },
        },
      ],
      nextCursor: null,
    });
    expect(parsedComponents.components[0]?.canonicalPurl).toBe(
      "pkg:npm/example@1.0.0",
    );
  });

  it("bounds cursor queries and rejects a cross-document tree parent", () => {
    expect(
      sbomComponentSearchQuerySchema.parse({ q: "example", limit: "50" }),
    ).toMatchObject({ q: "example", limit: 50 });
    expect(
      sbomDependencyTreeQuerySchema.safeParse({
        parentComponentId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      sbomDocumentListResponseSchema.parse({
        documents: [document],
        nextCursor: null,
      }),
    ).toMatchObject({ documents: [{ sourceId }] });
  });
});
