import { Readable } from "node:stream";

import {
  normalizePurl,
  normalizeSbomStream,
  resolveSbomGraph,
  SbomNormalizationError,
} from "./sbom-normalizer";

function chunks(value: string, size = 7): Readable {
  return Readable.from(
    Array.from({ length: Math.ceil(value.length / size) }, (_, index) =>
      Buffer.from(value.slice(index * size, (index + 1) * size)),
    ),
  );
}

function cyclonedxCorpus(componentCount: number): Readable {
  return Readable.from(
    (function* () {
      yield Buffer.from(
        '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[',
      );
      for (let index = 0; index < componentCount; index += 1) {
        yield Buffer.from(
          `${index === 0 ? "" : ","}{"bom-ref":"pkg:npm/component-${index}@1","name":"component-${index}","version":"1"}`,
        );
      }
      yield Buffer.from("]}");
    })(),
  );
}

describe("normalizePurl", () => {
  it("canonicalizes only valid package URLs and preserves raw values", () => {
    expect(
      normalizePurl("pkg:NPM/%40scope%2Fname@1.0.0?b=2&a=1#src%2Fmain"),
    ).toEqual({
      rawPurl: "pkg:NPM/%40scope%2Fname@1.0.0?b=2&a=1#src%2Fmain",
      canonicalPurl: "pkg:npm/%40scope%2Fname@1.0.0?a=1&b=2#src/main",
      ecosystem: "npm",
    });
    expect(normalizePurl("not a purl")).toEqual({
      rawPurl: "not a purl",
      canonicalPurl: null,
      ecosystem: null,
    });
  });
});

describe("normalizeSbomStream", () => {
  it("extracts CycloneDX JSON one record at a time without whole-document parsing", async () => {
    const result = await normalizeSbomStream(
      chunks(
        JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.6",
          components: [
            {
              "bom-ref": "a",
              type: "library",
              name: "Example",
              version: " 1.0.0 ",
              purl: "pkg:npm/example@1.0.0",
              supplier: { name: "Example supplier" },
              licenses: [
                { license: { expression: "MIT" } },
                { license: { name: "Apache-2.0" } },
              ],
            },
            { "bom-ref": "b", name: "child", version: "2" },
          ],
          dependencies: [{ ref: "a", dependsOn: ["b", "missing", "a", "b"] }],
        }),
      ),
      { maximumBytes: 10_000, maximumComponents: 10 },
    );

    expect(result.format).toBe("cyclonedx-json");
    expect(result.components).toEqual([
      expect.objectContaining({
        localRef: "a",
        rawName: "Example",
        rawVersion: " 1.0.0 ",
        normalizedVersion: "1.0.0",
        canonicalPurl: "pkg:npm/example@1.0.0",
        ecosystem: "npm",
        supplierValues: ["Example supplier"],
        licenseValues: ["MIT", "Apache-2.0"],
      }),
      expect.objectContaining({ localRef: "b", rawName: "child" }),
    ]);
    expect(result.edges).toEqual([
      expect.objectContaining({ fromRef: "a", toRef: "b" }),
      expect.objectContaining({ fromRef: "a", toRef: "missing" }),
      expect.objectContaining({ fromRef: "a", toRef: "a" }),
      expect.objectContaining({ fromRef: "a", toRef: "b" }),
    ]);
  });

  it("extracts CycloneDX XML and SPDX tag-value incrementally", async () => {
    const xml = await normalizeSbomStream(
      chunks(
        `<?xml version="1.0"?><bom><components><component bom-ref="a" type="library"><name>example</name><version>1</version><purl>pkg:npm/example@1</purl></component></components><dependencies><dependency ref="a"><dependency ref="b"/></dependency></dependencies></bom>`,
      ),
      { maximumBytes: 10_000, maximumComponents: 10 },
    );
    const tagValue = await normalizeSbomStream(
      chunks(
        "SPDXVersion: SPDX-2.3\nDocumentName: demo\n\nPackageName: example\nSPDXID: SPDXRef-a\nPackageVersion: 1\nExternalRef: PACKAGE-MANAGER purl pkg:npm/example@1\n",
      ),
      { maximumBytes: 10_000, maximumComponents: 10 },
    );

    expect(xml.components[0]).toEqual(
      expect.objectContaining({
        localRef: "a",
        canonicalPurl: "pkg:npm/example@1",
      }),
    );
    expect(xml.edges).toEqual([
      expect.objectContaining({ fromRef: "a", toRef: "b" }),
    ]);
    expect(tagValue.components[0]).toEqual(
      expect.objectContaining({
        localRef: "SPDXRef-a",
        normalizedVersion: "1",
      }),
    );
  });

  it("extracts SPDX JSON and JSON-LD graph package records", async () => {
    const spdx2 = await normalizeSbomStream(
      chunks(
        JSON.stringify({
          spdxVersion: "SPDX-2.3",
          packages: [
            { SPDXID: "SPDXRef-a", name: "example", versionInfo: "1" },
          ],
          relationships: [
            {
              spdxElementId: "SPDXRef-a",
              relationshipType: "DEPENDS_ON",
              relatedSpdxElement: "SPDXRef-b",
            },
          ],
        }),
      ),
      { maximumBytes: 10_000, maximumComponents: 10 },
    );
    const spdx3 = await normalizeSbomStream(
      chunks(
        JSON.stringify({
          "@context": "https://spdx.org/rdf/3.0.0/spdx-context.jsonld",
          "@graph": [
            {
              type: "software_Package",
              spdxId: "a",
              name: "example",
              software_packageVersion: "1",
            },
          ],
        }),
      ),
      { maximumBytes: 10_000, maximumComponents: 10 },
    );

    expect(spdx2.format).toBe("spdx-json");
    expect(spdx2.edges[0]).toEqual(
      expect.objectContaining({ fromRef: "SPDXRef-a", toRef: "SPDXRef-b" }),
    );
    expect(spdx3.format).toBe("spdx-json-ld");
    expect(spdx3.components[0]).toEqual(
      expect.objectContaining({ localRef: "a", rawName: "example" }),
    );
  });

  it("fails stably when the streamed byte or component ceiling is exceeded", async () => {
    await expect(
      normalizeSbomStream(chunks('{"components":[]}'), {
        maximumBytes: 4,
        maximumComponents: 10,
      }),
    ).rejects.toMatchObject({ code: "normalization_byte_limit_exceeded" });
    await expect(
      normalizeSbomStream(
        chunks(JSON.stringify({ components: [{ name: "a" }, { name: "b" }] })),
        { maximumBytes: 10_000, maximumComponents: 1 },
      ),
    ).rejects.toMatchObject({ code: "normalization_component_limit_exceeded" });
  });

  it("retains streaming structural errors for malformed required component fields", async () => {
    const result = await normalizeSbomStream(
      chunks(
        JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.6",
          components: [{ type: "library", version: "1" }],
        }),
      ),
      { maximumBytes: 10_000, maximumComponents: 10 },
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "missing_component_name",
      }),
    );
  });

  it("fails while streaming duplicate document-local references before a graph can be persisted", async () => {
    await expect(
      normalizeSbomStream(
        chunks(
          JSON.stringify({
            bomFormat: "CycloneDX",
            components: [
              { "bom-ref": "same", name: "first", version: "1" },
              { "bom-ref": "same", name: "second", version: "1" },
            ],
          }),
        ),
        { maximumBytes: 10_000, maximumComponents: 10, retainResult: false },
      ),
    ).rejects.toMatchObject({ code: "conflicting_local_reference_identity" });
  });

  it("publishes bounded batches and awaits durable consumers before completion", async () => {
    const batches: Array<readonly string[]> = [];
    const result = await normalizeSbomStream(
      chunks(
        JSON.stringify({
          bomFormat: "CycloneDX",
          components: Array.from({ length: 5 }, (_, index) => ({
            "bom-ref": `ref-${index}`,
            name: `name-${index}`,
          })),
        }),
      ),
      {
        maximumBytes: 10_000,
        maximumComponents: 10,
        maximumBatchRows: 2,
        retainResult: false,
        onBatch: async (batch) => {
          await Promise.resolve();
          batches.push(
            batch.components.map((component) => component.localRef ?? ""),
          );
        },
      },
    );

    expect(batches).toEqual([
      ["ref-0", "ref-1"],
      ["ref-2", "ref-3"],
      ["ref-4"],
    ]);
    expect(result.components).toHaveLength(0);
  });

  it("normalizes a generated 50k corpus through bounded batches", async () => {
    let componentCount = 0;
    let maximumBatchRows = 0;
    const result = await normalizeSbomStream(cyclonedxCorpus(50_000), {
      maximumBytes: 20 * 1024 * 1024,
      maximumComponents: 50_000,
      maximumBatchRows: 250,
      retainResult: false,
      onBatch: (batch) => {
        componentCount += batch.components.length;
        maximumBatchRows = Math.max(
          maximumBatchRows,
          batch.components.length + batch.edges.length,
        );
        return Promise.resolve();
      },
    });

    expect(componentCount).toBe(50_000);
    expect(maximumBatchRows).toBeLessThanOrEqual(250);
    expect(result.components).toEqual([]);
  }, 60_000);
});

describe("resolveSbomGraph", () => {
  it("omits missing, duplicate, self, and cycle-forming edges deterministically", () => {
    const result = resolveSbomGraph({
      components: [
        {
          localRef: "a",
          source: { offset: 1, path: "$.components[0]", line: null },
        },
        {
          localRef: "b",
          source: { offset: 2, path: "$.components[1]", line: null },
        },
        {
          localRef: "c",
          source: { offset: 3, path: "$.components[2]", line: null },
        },
      ],
      edges: [
        {
          fromRef: "a",
          toRef: "b",
          source: { offset: 1, path: "$.dependencies[0]", line: null },
        },
        {
          fromRef: "a",
          toRef: "b",
          source: { offset: 2, path: "$.dependencies[1]", line: null },
        },
        {
          fromRef: "b",
          toRef: "b",
          source: { offset: 3, path: "$.dependencies[2]", line: null },
        },
        {
          fromRef: "b",
          toRef: "a",
          source: { offset: 4, path: "$.dependencies[3]", line: null },
        },
        {
          fromRef: "a",
          toRef: "missing",
          source: { offset: 5, path: "$.dependencies[4]", line: null },
        },
        {
          fromRef: "b",
          toRef: "c",
          source: { offset: 6, path: "$.dependencies[5]", line: null },
        },
      ],
    });

    expect(result.edges.map((edge) => [edge.fromRef, edge.toRef])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(result.components).toEqual([
      expect.objectContaining({
        localRef: "a",
        canonicalParentRef: null,
        depth: 0,
      }),
      expect.objectContaining({
        localRef: "b",
        canonicalParentRef: "a",
        depth: 1,
      }),
      expect.objectContaining({
        localRef: "c",
        canonicalParentRef: "b",
        depth: 2,
      }),
    ]);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "duplicate_dependency_edge",
      "self_dependency_edge",
      "cycle_dependency_edge",
      "missing_dependency_reference",
    ]);
  });

  it("rejects duplicate local references and conflicting identities", () => {
    try {
      resolveSbomGraph({
        components: [
          {
            localRef: "a",
            source: { offset: 1, path: "$[0]", line: null },
            canonicalPurl: "pkg:npm/a@1",
          },
          {
            localRef: "a",
            source: { offset: 2, path: "$[1]", line: null },
            canonicalPurl: "pkg:npm/a@2",
          },
        ],
        edges: [],
      });
      throw new Error("expected an ambiguous local reference error");
    } catch (error) {
      expect(error).toBeInstanceOf(SbomNormalizationError);
      expect((error as SbomNormalizationError).code).toBe(
        "conflicting_local_reference_identity",
      );
    }
  });
});
