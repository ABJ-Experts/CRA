import { createHash } from "node:crypto";
import { z } from "zod";
import {
  serializeSbomExport,
  type SbomExportGraph,
} from "./sbom-export-serializer";
const id = "11111111-1111-4111-8111-111111111111";
const graph: SbomExportGraph = {
  documentId: id,
  sourceId: id,
  productId: id,
  releaseId: id,
  createdAt: "2026-09-28T00:00:00Z",
  components: [
    {
      id,
      name: "<script>alert(1)</script>",
      version: "1.0",
      purl: "pkg:npm/example@1.0",
      cpe: null,
      supplier: null,
      license: null,
      hashes: [],
    },
  ],
  dependencies: [],
};
describe("normalized SBOM export", () => {
  it.each(["cyclonedx", "spdx"] as const)(
    "validates %s serialization and hashes exact bytes",
    async (format) => {
      const result = await serializeSbomExport(
        graph,
        { sourceId: id, format, includeVex: false },
        [],
      );
      expect(result.export.content).toContain("<script>alert(1)</script>");
      expect(result.export.sha256).toBe(
        createHash("sha256")
          .update(Buffer.from(result.export.content, "utf8"))
          .digest("hex"),
      );
      expect(JSON.parse(result.export.content)).toMatchObject(
        format === "cyclonedx"
          ? { bomFormat: "CycloneDX", specVersion: "1.6" }
          : { spdxVersion: "SPDX-2.3" },
      );
    },
  );
  it("refuses missing reviewed VEX rather than silently omitting it", async () => {
    await expect(
      serializeSbomExport(
        graph,
        { sourceId: id, format: "cyclonedx", includeVex: true },
        [],
      ),
    ).rejects.toThrow("No reviewed");
  });
  it("preserves every exact graph edge and rejects dangling references", async () => {
    await expect(
      serializeSbomExport(
        { ...graph, dependencies: [{ parentId: id, childId: "missing" }] },
        { sourceId: id, format: "cyclonedx", includeVex: false },
        [],
      ),
    ).rejects.toThrow("Unresolved");
  });
});
const approved = {
  findingId: id,
  assessmentId: id,
  revision: 1,
  advisoryId: "CVE-2026-1001",
  canonicalPurl: "pkg:npm/example@1.0",
  componentVersion: "1.0",
  status: "not_affected" as const,
  justification: "vulnerable_code_not_present" as const,
  approvalState: "approved" as const,
  effectiveAt: "2026-09-28T00:00:00Z",
  provenanceReference: `${id}:1`,
};
describe("reviewed VEX and portable metadata", () => {
  it("embeds only effective reviewed VEX bound to exact exported component refs", async () => {
    const result = await serializeSbomExport(
      graph,
      { sourceId: id, format: "cyclonedx", includeVex: true },
      [approved],
    );
    const parsed = z
      .object({
        vulnerabilities: z.array(
          z.object({ affects: z.array(z.object({ ref: z.string() })) }),
        ),
      })
      .parse(JSON.parse(result.export.content));
    expect(parsed.vulnerabilities[0]!.affects).toEqual([
      { ref: `urn:uuid:${id}` },
    ]);
    expect(result.export.vex).toEqual({
      status: "included",
      assessmentCount: 1,
    });
    expect(result.export.content).not.toContain("private rationale");
  });
  it("refuses VEX referencing another SBOM and unsupported SPDX embedding", async () => {
    await expect(
      serializeSbomExport(
        graph,
        { sourceId: id, format: "cyclonedx", includeVex: true },
        [{ ...approved, canonicalPurl: "pkg:npm/other@1.0" }],
      ),
    ).rejects.toThrow("absent");
    await expect(
      serializeSbomExport(
        graph,
        { sourceId: id, format: "spdx", includeVex: true },
        [approved],
      ),
    ).rejects.toThrow("cannot embed");
  });
  it.each(["cyclonedx", "spdx"] as const)(
    "preserves representable optional %s fields and exact relationships",
    async (format) => {
      const child = "22222222-2222-4222-8222-222222222222";
      const full = {
        ...graph,
        components: [
          {
            ...graph.components[0]!,
            supplier: "Example supplier",
            license: "MIT",
            cpe: "cpe:2.3:a:example:example:1.0:*:*:*:*:*:*:*",
            hashes: [{ algorithm: "SHA-256", value: "a".repeat(64) }],
          },
          {
            ...graph.components[0]!,
            id: child,
            name: "Child",
            version: null,
            purl: null,
          },
        ],
        dependencies: [{ parentId: id, childId: child }],
      };
      const result = await serializeSbomExport(
        full,
        { sourceId: id, format, includeVex: false },
        [],
      );
      const parsed = z
        .object({
          dependencies: z
            .array(z.object({ dependsOn: z.array(z.string()) }))
            .optional(),
          relationships: z
            .array(z.object({ relatedSpdxElement: z.string() }))
            .optional(),
        })
        .parse(JSON.parse(result.export.content));
      expect(
        format === "cyclonedx"
          ? parsed.dependencies![0]!.dependsOn
          : parsed.relationships!.at(-1)!.relatedSpdxElement,
      ).toEqual(
        format === "cyclonedx" ? [`urn:uuid:${child}`] : `SPDXRef-${child}`,
      );
      expect(result.export.content).toContain("Example supplier");
      expect(result.export.content).toContain("MIT");
    },
  );
  it("rejects unrepresentable hashes and duplicate identifiers explicitly", async () => {
    await expect(
      serializeSbomExport(
        {
          ...graph,
          components: [
            {
              ...graph.components[0]!,
              hashes: [{ algorithm: "NOT-A-HASH", value: "invalid" }],
            },
          ],
        },
        { sourceId: id, format: "spdx", includeVex: false },
        [],
      ),
    ).rejects.toThrow("represented");
    await expect(
      serializeSbomExport(
        { ...graph, components: [...graph.components, ...graph.components] },
        { sourceId: id, format: "cyclonedx", includeVex: false },
        [],
      ),
    ).rejects.toThrow("Unresolved");
  });
  it("rejects a component count beyond the configured portable ceiling", async () => {
    await expect(
      serializeSbomExport(
        { ...graph, components: Array(50_001).fill(graph.components[0]) },
        { sourceId: id, format: "cyclonedx", includeVex: false },
        [],
      ),
    ).rejects.toThrow("ceiling");
  });
});
it("never emits empty VEX affects when M5 normalizes a versionless identity", async () => {
  await expect(
    serializeSbomExport(
      {
        ...graph,
        components: [{ ...graph.components[0]!, purl: "pkg:npm/example" }],
      },
      { sourceId: id, format: "cyclonedx", includeVex: true },
      [{ ...approved, canonicalPurl: "pkg:npm/example" }],
    ),
  ).rejects.toThrow("exact SBOM");
});
