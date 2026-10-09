import { describe, expect, it } from "vitest";
import { sbomExportQuerySchema } from "./sbom-export.schema.js";
const sourceId = "11111111-1111-4111-8111-111111111111";
describe("SBOM export query", () => {
  it("parses explicit booleans and defaults without boolean coercion", () => {
    expect(
      sbomExportQuerySchema.parse({
        sourceId,
        format: "cyclonedx",
        includeVex: "false",
      }).includeVex,
    ).toBe(false);
    expect(
      sbomExportQuerySchema.parse({
        sourceId,
        format: "cyclonedx",
        includeVex: "true",
      }).includeVex,
    ).toBe(true);
    expect(
      sbomExportQuerySchema.parse({ sourceId, format: "spdx" }).includeVex,
    ).toBe(false);
  });
  it("rejects unsupported SPDX VEX, missing exact source and caller tenant", () => {
    for (const input of [
      { sourceId, format: "spdx", includeVex: "true" },
      { format: "cyclonedx" },
      { sourceId, format: "cyclonedx", organizationId: sourceId },
      { sourceId, format: "cyclonedx", includeVex: "yes" },
    ])
      expect(sbomExportQuerySchema.safeParse(input).success).toBe(false);
  });
});
import { sbomExportResponseSchema } from "./sbom-export.schema.js";
const exported = {
  documentId: sourceId,
  sourceId,
  format: "cyclonedx",
  specificationVersion: "1.6",
  fileName: `sbom-${sourceId}.cdx.json`,
  mediaType: "application/vnd.cyclonedx+json",
  sha256: "a".repeat(64),
  content: "{}",
  vex: { status: "not_requested", assessmentCount: 0 },
};
describe("SBOM export response", () => {
  it("requires exact format metadata and explicit VEX status", () => {
    expect(
      sbomExportResponseSchema.safeParse({ export: exported }).success,
    ).toBe(true);
    expect(
      sbomExportResponseSchema.safeParse({
        export: {
          ...exported,
          format: "spdx",
          specificationVersion: "2.3",
          fileName: `sbom-${sourceId}.spdx.json`,
          mediaType: "application/spdx+json",
        },
      }).success,
    ).toBe(true);
    expect(
      sbomExportResponseSchema.safeParse({
        export: {
          ...exported,
          vex: { status: "included", assessmentCount: 1 },
        },
      }).success,
    ).toBe(true);
    for (const change of [
      { specificationVersion: "2.3" },
      { mediaType: "application/spdx+json" },
      { vex: { status: "not_requested", assessmentCount: 1 } },
      { vex: { status: "included", assessmentCount: 0 } },
      { sourceId: "not-a-uuid" },
      { sha256: "wrong" },
      { fileName: "../../private.json" },
      { content: "" },
    ])
      expect(
        sbomExportResponseSchema.safeParse({
          export: { ...exported, ...change },
        }).success,
      ).toBe(false);
    expect(
      sbomExportResponseSchema.safeParse({
        export: {
          ...exported,
          format: "spdx",
          specificationVersion: "2.3",
          mediaType: "application/spdx+json",
          vex: { status: "included", assessmentCount: 1 },
        },
      }).success,
    ).toBe(false);
  });
});
