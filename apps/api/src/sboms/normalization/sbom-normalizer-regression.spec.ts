import { Readable } from "node:stream";
import { normalizeSbomStream } from "./sbom-normalizer";

const options = { maximumBytes: 100_000, maximumComponents: 100 };
const stream = (text: string) => Readable.from([Buffer.from(text)]);

describe("M3 streaming normalization regressions", () => {
  it("retains fatal diagnostic counts after the visible warning ceiling", async () => {
    const result = await normalizeSbomStream(
      stream(
        JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.6",
          components: [{ name: "ok", purl: "invalid" }, { version: "1" }],
        }),
      ),
      { ...options, maximumDiagnostics: 1 },
    );
    expect(result).toMatchObject({
      errorCount: 1,
      warningCount: 1,
      omittedDiagnosticCount: 1,
    });
  });

  it("awaits XML publication before consuming the complete document", async () => {
    let consumed = 0;
    let firstBatch = 0;
    async function* input() {
      await Promise.resolve();
      yield Buffer.from(
        '<bom xmlns="http://cyclonedx.org/schema/bom/1.6"><components>',
      );
      for (let index = 0; index < 40; index += 1) {
        consumed += 1;
        yield Buffer.from(
          `<component bom-ref="${index}" type="library"><name>x${index}</name></component>`,
        );
      }
      yield Buffer.from("</components></bom>");
    }
    await normalizeSbomStream(input(), {
      ...options,
      retainResult: false,
      maximumBatchRows: 1,
      onBatch: async () => {
        if (firstBatch === 0) firstBatch = consumed;
        await Promise.resolve();
      },
    });
    expect(firstBatch).toBeLessThan(40);
  });

  it("preserves SPDX tag-value repeated references, checksums and dependencies", async () => {
    const result = await normalizeSbomStream(
      stream(
        "SPDXVersion: SPDX-2.3\nPackageName: a\nSPDXID: SPDXRef-a\nExternalRef: PACKAGE-MANAGER purl pkg:npm/a@1\nExternalRef: SECURITY cpe23Type cpe:2.3:a:x\nPackageChecksum: SHA256: abc\nPackageVersion: 1\nPackageName: b\nSPDXID: SPDXRef-b\nRelationship: SPDXRef-a DEPENDS_ON SPDXRef-b\n",
      ),
      options,
    );
    expect(result.components[0]).toMatchObject({
      canonicalPurl: "pkg:npm/a@1",
      hashes: [{ algorithm: "SHA256", value: "abc" }],
    });
    expect(result.edges).toEqual([
      expect.objectContaining({ fromRef: "SPDXRef-a", toRef: "SPDXRef-b" }),
    ]);
  });

  it("rejects malformed UTF-8 instead of replacing evidence text", async () => {
    const input = Readable.from([
      Buffer.from("<bom><components><component><name>"),
      Buffer.from([0xff]),
      Buffer.from("</name></component></components></bom>"),
    ]);
    await expect(normalizeSbomStream(input, options)).rejects.toMatchObject({
      code: "normalization_malformed_input",
    });
  });
  it("preserves non-Error durable sink failures without marking input invalid", async () => {
    const failure = { unavailable: true };
    await expect(
      normalizeSbomStream(
        stream(
          '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[{"name":"x"}]}',
        ),
        {
          ...options,
          // The provider can reject a non-Error value; preserve it for retry handling.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          onBatch: () => Promise.reject(failure),
        },
      ),
    ).rejects.toBe(failure);
  });
  it("normalizes SPDX inverse and canonical many-target dependency relationships", async () => {
    const spdx2 = await normalizeSbomStream(
      stream(
        JSON.stringify({
          spdxVersion: "SPDX-2.3",
          relationships: [
            {
              spdxElementId: "child",
              relationshipType: "DEPENDENCY_OF",
              relatedSpdxElement: "parent",
            },
          ],
        }),
      ),
      options,
    );
    expect(spdx2.edges).toEqual([
      expect.objectContaining({ fromRef: "parent", toRef: "child" }),
    ]);
    const spdx3 = await normalizeSbomStream(
      stream(
        JSON.stringify({
          "@context": "https://spdx.org/rdf/3.0.0/spdx-context.jsonld",
          "@graph": [
            {
              type: "Relationship",
              relationshipType: "dependsOn",
              from: "parent",
              to: ["a", "b"],
            },
          ],
        }),
      ),
      options,
    );
    expect(spdx3.edges).toEqual([
      expect.objectContaining({ fromRef: "parent", toRef: "a" }),
      expect.objectContaining({ fromRef: "parent", toRef: "b" }),
    ]);
  });
});

describe("SPDX 3 referenced hashes", () => {
  const hash = {
    type: "Hash",
    spdxId: "urn:hash:a",
    algorithm: "sha256",
    hashValue: "a".repeat(64),
  };
  const pkg = {
    type: "software_Package",
    spdxId: "urn:pkg:a",
    name: "a",
    verifiedUsing: ["urn:hash:a", "urn:missing"],
  };
  const document = (nodes: unknown[]) =>
    JSON.stringify({
      "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
      "@graph": nodes,
    });
  it.each([true, false])(
    "resolves hashes regardless of graph order (%s)",
    async (before) => {
      const result = await normalizeSbomStream(
        stream(document(before ? [hash, pkg] : [pkg, hash])),
        options,
      );
      expect(result.components[0]?.hashes).toEqual([
        { algorithm: "SHA256", value: hash.hashValue },
      ]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "unresolved_spdx3_hash" }),
      );
    },
  );
  it("uses a bounded scan catalog for batches without retaining component payloads", async () => {
    const body = document([pkg, hash]);
    const scan = await normalizeSbomStream(stream(body), {
      ...options,
      retainResult: false,
    });
    expect(scan.components).toEqual([]);
    const batches: unknown[] = [];
    await normalizeSbomStream(stream(body), {
      ...options,
      retainResult: false,
      spdx3HashCatalog: scan.spdx3HashCatalog,
      onBatch: async (batch) => {
        await Promise.resolve();
        batches.push(...batch.components);
      },
    });
    expect(batches[0]).toMatchObject({
      hashes: [{ algorithm: "SHA256", value: hash.hashValue }],
    });
  });
  it("bounds verification catalog and references independently of retained payloads", async () => {
    await expect(
      normalizeSbomStream(
        stream(document([hash, { ...hash, spdxId: "urn:hash:b" }])),
        { ...options, maximumComponents: 1, retainResult: false },
      ),
    ).rejects.toThrow("verification record count");
    await expect(
      normalizeSbomStream(
        stream(
          document([{ ...pkg, verifiedUsing: Array(129).fill("urn:hash:a") }]),
        ),
        options,
      ),
    ).rejects.toThrow("verification references");
  });
  it("preserves multiple declared digests including weak hashes without granting quality", async () => {
    const second = {
      ...hash,
      spdxId: "urn:hash:b",
      algorithm: "md5",
      hashValue: "b".repeat(32),
    };
    const result = await normalizeSbomStream(
      stream(
        document([
          { ...pkg, verifiedUsing: [hash.spdxId, second.spdxId] },
          hash,
          second,
        ]),
      ),
      options,
    );
    expect(result.components[0]?.hashes).toEqual([
      { algorithm: "SHA256", value: hash.hashValue },
      { algorithm: "MD5", value: second.hashValue },
    ]);
  });
  it("rejects 101 hashes during scan before any durable replay", async () => {
    const hashes = Array.from({ length: 101 }, (_, i) => ({
      ...hash,
      spdxId: `urn:hash:${i}`,
    }));
    await expect(
      normalizeSbomStream(
        stream(
          document([
            { ...pkg, verifiedUsing: hashes.map((item) => item.spdxId) },
            ...hashes,
          ]),
        ),
        { ...options, maximumComponents: 200, retainResult: false },
      ),
    ).rejects.toThrow("verification references");
  });
  it("does not fabricate a hash for conflicting IDs or unknown algorithms", async () => {
    const result = await normalizeSbomStream(
      stream(
        document([
          pkg,
          hash,
          { ...hash, hashValue: "b".repeat(64) },
          { ...hash, spdxId: "urn:hash:unknown", algorithm: "invented" },
        ]),
      ),
      options,
    );
    expect(result.components[0]?.hashes).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ambiguous_spdx3_hash" }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid_spdx3_hash" }),
    );
  });
});

describe("normalized persistence contract limits", () => {
  it.each([1024, 1025])(
    "validates original component names at %s characters",
    async (count) => {
      const result = normalizeSbomStream(
        stream(
          JSON.stringify({
            bomFormat: "CycloneDX",
            specVersion: "1.6",
            components: [{ type: "library", name: "x".repeat(count) }],
          }),
        ),
        options,
      );
      if (count === 1024)
        expect((await result).components[0]?.rawName).toHaveLength(1024);
      else await expect(result).rejects.toThrow("normalized persistence");
    },
  );
  it.each([
    { "bom-ref": "r".repeat(1025) },
    { version: "v".repeat(1025) },
    { scope: "s".repeat(121) },
    { supplier: { name: "s".repeat(1025) } },
    {
      hashes: Array.from({ length: 101 }, () => ({
        alg: "SHA-256",
        content: "a".repeat(64),
      })),
    },
    { hashes: [{ alg: "a".repeat(33), content: "x" }] },
    { hashes: [{ alg: "SHA-256", content: "x".repeat(1025) }] },
    {
      licenses: Array.from({ length: 21 }, (_, i) => ({
        license: { name: `license-${i}` },
      })),
    },
  ])(
    "rejects a DB-incompatible component before scan succeeds %j",
    async (extra) => {
      await expect(
        normalizeSbomStream(
          stream(
            JSON.stringify({
              bomFormat: "CycloneDX",
              specVersion: "1.6",
              components: [{ type: "library", name: "x", ...extra }],
            }),
          ),
          { ...options, retainResult: false },
        ),
      ).rejects.toThrow("normalized persistence");
    },
  );
  it("validates dependency reference bounds before publishing", async () => {
    await expect(
      normalizeSbomStream(
        stream(
          JSON.stringify({
            bomFormat: "CycloneDX",
            specVersion: "1.6",
            dependencies: [{ ref: "r".repeat(1025), dependsOn: ["x"] }],
          }),
        ),
        options,
      ),
    ).rejects.toThrow("normalized persistence");
  });
});
