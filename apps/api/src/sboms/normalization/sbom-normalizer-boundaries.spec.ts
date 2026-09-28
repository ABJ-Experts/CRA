import { Readable } from "node:stream";
import {
  normalizePurl,
  normalizeVersion,
  normalizeSbomStream,
  type SbomNormalizationOptions,
} from "./sbom-normalizer";
const options = { maximumBytes: 100_000, maximumComponents: 100 };
function stream(value: string): Readable {
  const bytes = Buffer.from(value);
  return Readable.from(
    Array.from({ length: bytes.length }, (_, index) =>
      bytes.subarray(index, index + 1),
    ),
  );
}
function normalizeJson(
  value: unknown,
  extra: Partial<SbomNormalizationOptions> = {},
) {
  return normalizeSbomStream(stream(JSON.stringify(value)), {
    ...options,
    ...extra,
  });
}
describe("normalization operational boundaries", () => {
  it.each([
    { maximumBytes: 0 },
    { maximumBytes: 1.5 },
    { maximumComponents: 0 },
    { maximumComponents: Number.NaN },
    { maximumBatchRows: 0 },
    { maximumBatchRows: 1001 },
    { maximumBatchRows: 1.5 },
    { maximumBatchBytes: 0 },
    { maximumBatchBytes: 8 * 1024 * 1024 + 1 },
    { maximumBatchBytes: 1.5 },
    { maximumDiagnostics: 0 },
    { maximumDiagnostics: 1001 },
    { maximumDiagnostics: 1.5 },
  ])(
    "rejects invalid server limits before consuming data %j",
    async (invalid) => {
      const source = {
        async *[Symbol.asyncIterator]() {
          await Promise.resolve();
          throw new Error("must not consume");
          yield Buffer.alloc(0);
        },
      };
      await expect(
        normalizeSbomStream(source, { ...options, ...invalid }),
      ).rejects.toThrow(/normalizer/u);
    },
  );
  it("does not invent identifiers, ecosystem or versions for missing data", () => {
    expect(normalizePurl(null)).toEqual({
      rawPurl: null,
      canonicalPurl: null,
      ecosystem: null,
    });
    expect(normalizePurl(undefined).canonicalPurl).toBeNull();
    expect(normalizePurl("").rawPurl).toBe("");
    expect(normalizePurl("pkg:generic/example@one").ecosystem).toBe("generic");
    expect(normalizeVersion(undefined)).toBeNull();
    expect(normalizeVersion(null)).toBeNull();
    expect(normalizeVersion("  release-alpha  ")).toBe("release-alpha");
  });
  it("rejects unsupported bytes and malformed UTF-8 without a partial result", async () => {
    await expect(
      normalizeSbomStream(stream("arbitrary non-SBOM text"), options),
    ).rejects.toMatchObject({ code: "normalization_unsupported_format" });
    await expect(
      normalizeSbomStream(Readable.from([Buffer.from([0xff])]), options),
    ).rejects.toMatchObject({ code: "normalization_malformed_input" });
  });
  it("counts all diagnostics while bounding their response payload", async () => {
    const result = await normalizeJson(
      {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        components: [
          { name: " ", purl: "not a purl" },
          { purl: "not a purl" },
          { name: "Safe", purl: "not a purl" },
        ],
      },
      { maximumDiagnostics: 1 },
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.warningCount).toBe(3);
    expect(result.errorCount).toBe(2);
    expect(result.omittedDiagnosticCount).toBe(4);
  });
  it("awaits row-byte batch flushes and returns no duplicate retained graph in worker mode", async () => {
    const batches: unknown[] = [];
    const onBatch = jest.fn(async (batch: unknown) => {
      await Promise.resolve();
      batches.push(batch);
    });
    const result = await normalizeJson(
      {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        components: [{ "bom-ref": "a", name: "école" }],
        dependencies: [{ ref: "a", dependsOn: ["b"] }],
      },
      { onBatch, maximumBatchBytes: 1, retainResult: false },
    );
    expect(onBatch).toHaveBeenCalledTimes(2);
    expect(batches).toEqual([
      expect.objectContaining({
        components: [expect.objectContaining({ rawName: "école" })],
        edges: [],
      }),
      expect.objectContaining({
        components: [],
        edges: [expect.objectContaining({ fromRef: "a", toRef: "b" })],
      }),
    ]);
    expect(result.components).toEqual([]);
    expect(result.edges).toEqual([]);
  });
  it("propagates durable batch and progress failures rather than treating them as valid evidence", async () => {
    const unavailable = new Error("storage interrupted");
    await expect(
      normalizeJson(
        { components: [{ name: "a" }] },
        {
          onBatch: async () => {
            await Promise.resolve();
            throw unavailable;
          },
        },
      ),
    ).rejects.toBe(unavailable);
    await expect(
      normalizeSbomStream(stream('{"components":[]}'), {
        ...options,
        onProgress: async () => {
          await Promise.resolve();
          throw unavailable;
        },
      }),
    ).rejects.toThrow("storage interrupted");
  });
});
describe("source representation boundaries", () => {
  it("extracts exact SPDX hashes/PURL while ignoring unrelated or malformed optional refs", async () => {
    const result = await normalizeJson({
      spdxVersion: "SPDX-2.3",
      packages: [
        {
          SPDXID: "SPDXRef-a",
          name: "Example",
          supplier: "Person: Example",
          licenseConcluded: "MIT",
          checksums: [
            null,
            [],
            { algorithm: "SHA256" },
            { algorithm: "SHA256", checksumValue: "a".repeat(64) },
          ],
          externalRefs: [
            null,
            [],
            {
              referenceType: "cpe23Type",
              referenceLocator: "cpe:2.3:a:example:*:*:*:*:*:*:*:*:*",
            },
            { referenceType: "purl" },
            { referenceType: "purl", referenceLocator: "pkg:npm/example@1" },
          ],
        },
      ],
      relationships: [
        {
          relationshipType: "CONTAINS",
          spdxElementId: "SPDXRef-DOCUMENT",
          relatedSpdxElement: "SPDXRef-a",
        },
      ],
    });
    expect(result.components[0]).toMatchObject({
      canonicalPurl: "pkg:npm/example@1",
      hashes: [{ algorithm: "SHA256", value: "a".repeat(64) }],
      supplier: "Person: Example",
    });
    expect(result.edges).toEqual([]);
  });
  it("retains SPDX3 missing-name/identifier diagnostics without inventing a package", async () => {
    const result = await normalizeJson({
      "@context": "https://spdx.org/rdf/3.0.0/spdx-context.jsonld",
      "@graph": [
        { type: "software_Package", software_packageVersion: "1" },
        { type: "CreationInfo", specVersion: "3.0" },
      ],
    });
    expect(result.errorCount).toBe(2);
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "missing_spdx3_package_name",
        "missing_spdx_package_id",
      ]),
    );
  });
  it("preserves tag-value suppliers, multiple checksums, and reversed relationships across CRLF chunks", async () => {
    const text =
      "SPDXVersion: SPDX-2.3\r\n# comment\r\nMalformed line\r\nPackageName: école\r\nSPDXID: SPDXRef-a\r\nPackageSupplier: Person: Example\r\nPackageChecksum: SHA256: " +
      "a".repeat(64) +
      "\r\nPackageChecksum: SHA1: " +
      "b".repeat(40) +
      "\r\nExternalRef: SECURITY cpe23Type example\r\nExternalRef: PACKAGE-MANAGER purl invalid\r\nRelationship: SPDXRef-a DEPENDENCY_OF SPDXRef-b # declared\r\nRelationship: SPDXRef-a CONTAINS SPDXRef-b\r\nPackageName: second\r\nSPDXID: SPDXRef-b";
    const result = await normalizeSbomStream(stream(text), options);
    expect(result.components).toHaveLength(2);
    expect(result.components[0]).toMatchObject({
      rawName: "école",
      supplier: "Person: Example",
      hashes: [
        { algorithm: "SHA256", value: "a".repeat(64) },
        { algorithm: "SHA1", value: "b".repeat(40) },
      ],
    });
    expect(result.edges).toEqual([
      expect.objectContaining({ fromRef: "SPDXRef-b", toRef: "SPDXRef-a" }),
    ]);
    expect(result.warningCount).toBe(1);
  });
  it("extracts XML optional evidence and reports invalid identifiers and missing names", async () => {
    const xml =
      '<bom xmlns="http://cyclonedx.org/schema/bom/1.6"><components><component bom-ref="a" type="library"><name>école</name><supplier><name>Supplier</name></supplier><licenses><license><name>MIT</name></license></licenses><hashes><hash alg="SHA-256">' +
      "a".repeat(64) +
      '</hash></hashes><purl>invalid</purl></component><component bom-ref="b" type="library"><version>1</version></component></components></bom>';
    const result = await normalizeSbomStream(stream(xml), options);
    expect(result.components[0]).toMatchObject({
      rawName: "école",
      supplier: "Supplier",
      licenseValues: ["MIT"],
      hashes: [{ algorithm: "SHA-256", value: "a".repeat(64) }],
    });
    expect(result.warningCount).toBe(1);
    expect(result.errorCount).toBe(1);
  });
  it.each([
    "<bom><components><component name='broken'></bom>",
    "<bom><components><component bom-ref='a'><name>A</name></component><component bom-ref='b'><name>B</name></component></components></bom>",
  ])(
    "rejects malformed or oversized XML before graph completion",
    async (xml) => {
      await expect(
        normalizeSbomStream(stream(xml), { ...options, maximumComponents: 1 }),
      ).rejects.toThrow(/Malformed CycloneDX XML|SBOM component count/u);
    },
  );
});
