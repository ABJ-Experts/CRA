import { Readable } from "node:stream";
import { evaluateBsiProfile } from "../quality/bsi-profile-evaluator";
import { extractBsiProfileFacts } from "./bsi-profile-extractor";
const opts = {
  format: "cyclonedx" as const,
  serialization: "json" as const,
  specificationVersion: "1.6",
};
const input = (value: unknown) =>
  Readable.from([Buffer.from(JSON.stringify(value))]);
describe("bounded original BSI facts", () => {
  it("retains unique exact JSON component locations including nested arrays", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        components: [
          {
            "bom-ref": "a",
            name: "a",
            components: [{ "bom-ref": "nested", name: "nested" }],
          },
          { "bom-ref": "b", name: "b" },
        ],
      }),
      opts,
    );
    expect(
      Object.fromEntries(
        facts.components.map((item) => [item.reference, item.sourcePath]),
      ),
    ).toEqual({
      a: "$.components[0]",
      nested: "$.components[0].components[0]",
      b: "$.components[1]",
    });
  });
  it("rejects locations beyond the persisted finding path ceiling", async () => {
    let component: Record<string, unknown> = {
      "bom-ref": "leaf",
      name: "leaf",
    };
    for (let index = 0; index < 75; index += 1)
      component = {
        "bom-ref": `parent-${index}`,
        name: "parent",
        components: [component],
      };
    await expect(
      extractBsiProfileFacts(input({ components: [component] }), opts),
    ).rejects.toThrow("BSI source location ceiling exceeded.");
  });
  it("retains exact package and file indices", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        packages: [
          { SPDXID: "a", name: "a" },
          { SPDXID: "b", name: "b" },
        ],
        files: [{ SPDXID: "c", fileName: "c" }],
      }),
      { ...opts, format: "spdx", specificationVersion: "2.3" },
    );
    expect(facts.components.map((item) => item.sourcePath)).toEqual([
      "$.packages[0]",
      "$.packages[1]",
      "$.files[0]",
    ]);
  });
  it("counts non-component SPDX3 graph entries in exact locations", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        "@graph": [
          { type: "Person", spdxId: "agent", name: "Author" },
          { type: "software_Package", spdxId: "a", name: "a" },
          { type: "software_Package", spdxId: "b", name: "b" },
        ],
      }),
      {
        ...opts,
        format: "spdx",
        serialization: "json_ld",
        specificationVersion: "3.0",
      },
    );
    expect(facts.components.map((item) => item.sourcePath)).toEqual([
      '$["@graph"][1]',
      '$["@graph"][2]',
    ]);
  });
  it("retains unique XML sibling locations", async () => {
    const facts = await extractBsiProfileFacts(
      Readable.from([
        Buffer.from(
          '<bom xmlns="http://cyclonedx.org/schema/bom/1.6"><components><component bom-ref="a"><name>a</name><components><component bom-ref="nested"><name>nested</name></component></components></component><component bom-ref="b"><name>b</name></component></components></bom>',
        ),
      ]),
      { ...opts, serialization: "xml" },
    );
    expect(
      Object.fromEntries(
        facts.components.map((item) => [item.reference, item.sourcePath]),
      ),
    ).toEqual({
      a: "/bom[1]/components[1]/component[1]",
      nested: "/bom[1]/components[1]/component[1]/components[1]/component[1]",
      b: "/bom[1]/components[1]/component[2]",
    });
  });
  it("keeps creator distinct from supplier and licenses distinct by acknowledgement", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        metadata: {
          authors: [{ email: "creator@example.test" }],
          timestamp: "2026-09-28T00:00:00Z",
          component: { "bom-ref": "root", name: "root" },
        },
        serialNumber: "urn:uuid:test",
        components: [
          {
            "bom-ref": "a",
            name: "a",
            version: "1",
            supplier: { contact: [{ email: "supplier@example.test" }] },
            authors: [{ email: "author@example.test" }],
            licenses: [
              { license: { id: "MIT" } },
              { license: { id: "BSD-3-Clause" }, acknowledgement: "declared" },
              { expression: "Apache-2.0", acknowledgement: "concluded" },
            ],
            properties: [
              { name: "bsi:component:filename", value: "a.bin" },
              { name: "bsi:component:associatedLicenses", value: "MIT" },
              { name: "bsi:component:executable", value: "true" },
            ],
            hashes: [{ alg: "SHA-512", content: "a".repeat(128) }],
          },
        ],
        dependencies: [{ ref: "a", dependsOn: [] }],
      }),
      opts,
    );
    expect(facts.creatorContacts).toEqual(["creator@example.test"]);
    expect(facts.primaryComponentReference).toBe("root");
    expect(facts.components.find((x) => x.reference === "a")).toMatchObject({
      creatorContacts: ["author@example.test"],
      filename: "a.bin",
      sha512: ["a".repeat(128)],
      dependencies: [],
      associatedLicenses: ["MIT"],
      declaredLicenses: ["BSD-3-Clause"],
      concludedLicenses: ["Apache-2.0"],
      executable: true,
      archive: null,
      inDeliveryScope: null,
    });
  });
  it("does not treat supplier, package type or scope as creator or delivery declarations", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        components: [
          {
            name: "package",
            type: "application",
            scope: "required",
            supplier: { url: ["https://supplier.test"] },
          },
        ],
      }),
      opts,
    );
    expect(facts.components[0]).toMatchObject({
      creatorContacts: [],
      filename: null,
      executable: null,
      archive: null,
      structured: null,
      inDeliveryScope: null,
      dependencies: null,
    });
  });
  it("marks conflicting convention properties unknown", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        components: [
          {
            name: "a",
            properties: [
              { name: "bsi:component:archive", value: "true" },
              { name: "bsi:component:archive", value: "false" },
            ],
          },
        ],
      }),
      opts,
    );
    expect(facts.components[0]?.archive).toBeNull();
    expect(facts.limitations.join(" ")).toContain("conflicting");
  });
  it("preserves native SPDX2 license roles, originator and explicit no-dependencies", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        creationInfo: {
          creators: [
            "Person: Creator (creator@example.test)",
            "Tool: supplier@example.test",
          ],
          created: "2026-09-28T00:00:00Z",
        },
        documentNamespace: "https://sbom.test/doc",
        packages: [
          {
            SPDXID: "SPDXRef-a",
            name: "a",
            versionInfo: "1",
            originator: "Organization: Authors (https://authors.test)",
            supplier: "Organization: Supplier (supplier@example.test)",
            packageFileName: "/tmp/a.zip",
            licenseDeclared: "MIT",
            licenseConcluded: "Apache-2.0",
            checksums: [
              { algorithm: "SHA512", checksumValue: "a".repeat(128) },
            ],
          },
        ],
        relationships: [
          {
            spdxElementId: "SPDXRef-a",
            relationshipType: "DEPENDS_ON",
            relatedSpdxElement: "NONE",
          },
        ],
      }),
      { ...opts, format: "spdx", specificationVersion: "2.3" },
    );
    expect(facts.creatorContacts).toEqual(["creator@example.test"]);
    expect(facts.components[0]).toMatchObject({
      creatorContacts: ["https://authors.test"],
      filename: "a.zip",
      associatedLicenses: [],
      declaredLicenses: ["MIT"],
      concludedLicenses: ["Apache-2.0"],
      dependencies: [],
    });
  });
  it("resolves SPDX3 forward hashes and creators but never createdBy as component originator", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        "@graph": [
          {
            type: "software_Package",
            spdxId: "p",
            name: "a",
            originatedBy: ["agent"],
            verifiedUsing: ["hash"],
          },
          {
            type: "software_Package",
            spdxId: "q",
            name: "b",
            creationInfo: "creation",
          },
          {
            type: "SpdxDocument",
            spdxId: "https://sbom.test/doc",
            creationInfo: "creation",
          },
          {
            type: "CreationInfo",
            "@id": "creation",
            createdBy: ["agent"],
            created: "2026-09-28T00:00:00Z",
          },
          {
            type: "Person",
            spdxId: "agent",
            name: "Author (author@example.test)",
          },
          {
            type: "Hash",
            spdxId: "hash",
            algorithm: "sha512",
            hashValue: "b".repeat(128),
          },
          {
            type: "Relationship",
            from: "p",
            to: ["q"],
            relationshipType: "dependsOn",
          },
        ],
      }),
      {
        ...opts,
        format: "spdx",
        serialization: "json_ld",
        specificationVersion: "3.0",
      },
    );
    expect(facts.components[0]).toMatchObject({
      creatorContacts: ["author@example.test"],
      sha512: ["b".repeat(128)],
      dependencies: ["q"],
    });
    expect(facts.components[1]?.creatorContacts).toEqual([]);
    expect(facts.creatorContacts).toEqual(["author@example.test"]);
  });
  it("retains component external-reference roles without treating them as document contact", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        components: [
          {
            name: "a",
            externalReferences: [
              { type: "vcs", url: "https://repo.test/a" },
              { type: "distribution", url: "https://download.test/a" },
              { type: "bom", url: "https://bom.test/a" },
            ],
          },
        ],
      }),
      opts,
    );
    expect(facts.components[0]).toMatchObject({
      sourceCodeUris: ["https://repo.test/a"],
      deployableUris: ["https://download.test/a"],
    });
  });
  it("retains explicit unknown dependencies after another relationship", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        packages: [{ SPDXID: "a", name: "a" }],
        relationships: [
          {
            spdxElementId: "a",
            relationshipType: "DEPENDS_ON",
            relatedSpdxElement: "NOASSERTION",
          },
          {
            spdxElementId: "a",
            relationshipType: "DEPENDS_ON",
            relatedSpdxElement: "b",
          },
        ],
      }),
      { ...opts, format: "spdx", specificationVersion: "2.3" },
    );
    expect(facts.components[0]?.dependencies).toBeNull();
  });
  it("makes repeated SPDX document metadata unknown", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        "@graph": [
          {
            type: "SpdxDocument",
            spdxId: "https://one.test",
            creationInfo: "creation",
          },
          {
            type: "SpdxDocument",
            spdxId: "https://two.test",
            creationInfo: "creation",
          },
          {
            type: "CreationInfo",
            "@id": "creation",
            createdBy: ["agent"],
            created: "2026-09-28T00:00:00Z",
          },
          { type: "Person", spdxId: "agent", name: "author@example.test" },
        ],
      }),
      {
        ...opts,
        format: "spdx",
        serialization: "json_ld",
        specificationVersion: "3.0",
      },
    );
    expect(facts.documentUri).toBeNull();
    expect(facts.creatorContacts).toEqual([]);
    expect(facts.timestamp).toBeNull();
  });
  it("extracts equivalent CycloneDX XML facts incrementally", async () => {
    const xml =
      '<bom xmlns="http://cyclonedx.org/schema/bom/1.6" serialNumber="urn:bom"><metadata><timestamp>2026-09-28T00:00:00Z</timestamp><authors><author><email>creator@example.test</email></author></authors></metadata><components><component type="file" bom-ref="a"><name>a.bin</name><author>Author (author@example.test)</author><hashes><hash alg="SHA-512">' +
      "a".repeat(128) +
      '</hash></hashes><properties><property name="bsi:component:structured">false</property></properties></component></components><dependencies><dependency ref="a"/></dependencies></bom>';
    const facts = await extractBsiProfileFacts(
      Readable.from([Buffer.from(xml)]),
      { ...opts, serialization: "xml" },
    );
    expect(facts.components[0]).toMatchObject({
      reference: "a",
      filename: "a.bin",
      creatorContacts: ["author@example.test"],
      structured: false,
      dependencies: [],
      sha512: ["a".repeat(128)],
    });
    expect(facts.creatorContacts).toEqual(["creator@example.test"]);
  });
  it.each([
    '{"components":[',
    '{"components":[{"name":"a"}],"duplicate":1,"duplicate":2}',
  ])("never succeeds on malformed JSON %s", async (text) => {
    await expect(
      extractBsiProfileFacts(Readable.from([Buffer.from(text)]), opts),
    ).rejects.toThrow();
  });
  it("drains EOF and preserves upstream integrity failure", async () => {
    const failure = new Error("integrity");
    async function* chunks() {
      await Promise.resolve();
      yield Buffer.from('{"components":[]}');
      throw failure;
    }
    await expect(
      extractBsiProfileFacts(Readable.from(chunks()), opts),
    ).rejects.toThrow("integrity");
  });
  it.each([
    "<!DOCTYPE bom [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><bom/>",
    "<bom><component>",
  ])("rejects unsafe or malformed XML", async (text) => {
    await expect(
      extractBsiProfileFacts(Readable.from([Buffer.from(text)]), {
        ...opts,
        serialization: "xml",
      }),
    ).rejects.toThrow();
  });
  it("enforces byte and component ceilings and cancels the stream", async () => {
    const source = input({ components: [{ name: "a" }, { name: "b" }] });
    await expect(
      extractBsiProfileFacts(source, { ...opts, maximumComponents: 1 }),
    ).rejects.toThrow("component");
    expect(source.destroyed).toBe(true);
    await expect(
      extractBsiProfileFacts(input({ name: "x".repeat(30) }), {
        ...opts,
        maximumBytes: 10,
      }),
    ).rejects.toThrow("byte");
  });
});

describe("native BSI representation boundaries", () => {
  it("resolves SPDX3 declared/concluded license relationships without association", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        "@graph": [
          { type: "software_Package", spdxId: "p", name: "p" },
          {
            type: "Relationship",
            from: "p",
            to: ["declared"],
            relationshipType: "hasDeclaredLicense",
          },
          {
            type: "Relationship",
            from: "p",
            to: ["concluded"],
            relationshipType: "hasConcludedLicense",
          },
          {
            type: "simplelicensing_LicenseExpression",
            spdxId: "declared",
            simplelicensing_licenseExpression: "MIT",
          },
          {
            type: "simplelicensing_LicenseExpression",
            spdxId: "concluded",
            simplelicensing_licenseExpression: "Apache-2.0",
          },
        ],
      }),
      {
        ...opts,
        format: "spdx",
        serialization: "json_ld",
        specificationVersion: "3.0",
      },
    );
    expect(facts.components[0]).toMatchObject({
      declaredLicenses: ["MIT"],
      concludedLicenses: ["Apache-2.0"],
      associatedLicenses: [],
    });
  });
  it("extracts expression acknowledgement from native XML choice", async () => {
    const source = Readable.from([
      Buffer.from(
        '<bom><components><component bom-ref="a"><name>a</name><licenses><expression acknowledgement="concluded">MIT OR Apache-2.0</expression></licenses></component></components></bom>',
      ),
    ]);
    const facts = await extractBsiProfileFacts(source, {
      ...opts,
      serialization: "xml",
    });
    expect(facts.components[0]?.concludedLicenses).toEqual([
      "MIT OR Apache-2.0",
    ]);
  });
  it("bounds XML attribute/container aggregation before consuming the whole source", async () => {
    let consumed = 0;
    async function* parts() {
      await Promise.resolve();
      yield Buffer.from("<bom><metadata><authors>");
      for (let i = 0; i < 1200; i++) {
        consumed += 1;
        yield Buffer.from(
          '<author email="' + "a".repeat(1024) + '@example.test"/>',
        );
      }
      yield Buffer.from("</authors></metadata></bom>");
    }
    await expect(
      extractBsiProfileFacts(Readable.from(parts()), {
        ...opts,
        serialization: "xml",
      }),
    ).rejects.toThrow("subtree");
    expect(consumed).toBeLessThan(1200);
  });
});

describe("bounded ambiguity and operational behavior", () => {
  it.each([
    { maximumBytes: 0 },
    { maximumBytes: 100 * 1024 * 1024 + 1 },
    { maximumComponents: 0 },
    { maximumComponents: 50_001 },
  ])("rejects invalid bounds %j", async (extra) => {
    await expect(
      extractBsiProfileFacts(input({}), { ...opts, ...extra }),
    ).rejects.toThrow("bounds");
  });
  it("completes EOF and reports byte progress before returning immutable facts", async () => {
    const source = input({
      version: 3,
      metadata: {
        manufacturer: { url: ["https://creator.test"] },
        timestamp: "2026-09-28T00:00:00Z",
      },
      externalReferences: [{ type: "bom", url: "https://bom.test" }],
      vulnerabilities: [{ id: "CVE-2026-1" }],
      components: [{ name: "parent", components: [{ name: "child" }] }],
    });
    const progress: number[] = [];
    const facts = await extractBsiProfileFacts(source, {
      ...opts,
      onProgress: async (bytes) => {
        await Promise.resolve();
        progress.push(bytes);
      },
    });
    expect(source.readableEnded).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
    expect(Object.isFrozen(facts)).toBe(true);
    expect(facts.documentVersion).toBe("3");
    expect(facts.embeddedVulnerabilityInformation).toBe(true);
    expect(facts.components).toHaveLength(2);
    expect(facts.externalBomLinks).toEqual(["https://bom.test"]);
  });
  it("drains unsupported tag-value without pretending native fields were checked", async () => {
    const source = Readable.from([Buffer.from("SPDXVersion: SPDX-2.3")]);
    const facts = await extractBsiProfileFacts(source, {
      ...opts,
      format: "spdx",
      serialization: "tag_value",
      specificationVersion: "SPDX-2.3",
    });
    expect(source.readableEnded).toBe(true);
    expect(facts.limitations).toHaveLength(1);
    expect(facts.creatorContacts).toEqual([]);
  });
  it("rejects malicious UTF8 and oversized scalar fragments", async () => {
    await expect(
      extractBsiProfileFacts(Readable.from([Buffer.from([0xff])]), opts),
    ).rejects.toThrow();
    await expect(
      extractBsiProfileFacts(
        input({ components: [{ name: "x".repeat(1024 * 1024 + 1) }] }),
        opts,
      ),
    ).rejects.toThrow("ceiling");
  });
  it("propagates lease progress errors and cancels without success", async () => {
    const source = input({ components: [] });
    const failure = new Error("lease revoked");
    await expect(
      extractBsiProfileFacts(source, {
        ...opts,
        onProgress: async () => {
          await Promise.resolve();
          throw failure;
        },
      }),
    ).rejects.toThrow("lease revoked");
    expect(source.destroyed).toBe(true);
  });
  it.each([
    ["executable", "executable", true],
    ["executable", "non-executable", false],
    ["archive", "archive", true],
    ["archive", "no archive", false],
    ["structured", "structured", true],
    ["structured", "unstructured", false],
  ])(
    "accepts explicit taxonomy representation %s=%s",
    async (field, value, expected) => {
      const facts = await extractBsiProfileFacts(
        input({
          components: [
            {
              name: "a",
              properties: [{ name: `bsi:component:${field}`, value }],
            },
          ],
        }),
        opts,
      );
      expect(
        facts.components[0]?.[field as "archive" | "executable" | "structured"],
      ).toBe(expected);
    },
  );
  it("does not call equivalent boolean/enum declarations conflicting", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        components: [
          {
            name: "a",
            properties: [
              { name: "bsi:component:executable", value: "true" },
              { name: "bsi:component:executable", value: "executable" },
              { name: "bsi:component:archive", value: "maybe" },
              { name: "bsi:component:structured", value: "true" },
              { name: "bsi:component:inDeliveryScope", value: "false" },
              {
                name: "bsi:component:unavailableFields",
                value: "filename,sha512",
              },
            ],
          },
        ],
      }),
      opts,
    );
    expect(facts.components[0]).toMatchObject({
      executable: true,
      archive: null,
      structured: true,
      inDeliveryScope: false,
      unavailableFields: ["filename", "sha512"],
    });
  });
  it("does not assign licensing roles to native unacknowledged CDX licenses", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        components: [{ name: "a", licenses: [{ license: { id: "MIT" } }] }],
      }),
      opts,
    );
    expect(facts.components[0]).toMatchObject({
      associatedLicenses: [],
      declaredLicenses: [],
      concludedLicenses: [],
      uncertainFields: ["associatedLicenses"],
    });
    expect(facts.limitations.join(" ")).toContain("role is unspecified");
  });
  it.each([
    {
      id: "DocumentRef-supplier",
      document: "https://supplier.test/sbom",
      severity: "warning",
    },
    {
      id: "DocumentRef-other",
      document: "https://supplier.test/sbom",
      severity: "error",
    },
    {
      id: "supplier",
      document: "https://supplier.test/sbom",
      severity: "error",
    },
    { id: "DocumentRef-supplier", document: "NOASSERTION", severity: "error" },
  ])(
    "preserves exact native external document binding $id for dependency review",
    async ({ id, document, severity }) => {
      const facts = await extractBsiProfileFacts(
        input({
          packages: [
            { SPDXID: "SPDXRef-root", name: "root", versionInfo: "1.0" },
          ],
          externalDocumentRefs: [
            { externalDocumentId: id, spdxDocument: document },
          ],
          relationships: [
            {
              spdxElementId: "SPDXRef-root",
              relationshipType: "DEPENDS_ON",
              relatedSpdxElement: "DocumentRef-supplier:SPDXRef-core",
            },
          ],
        }),
        { ...opts, format: "spdx", specificationVersion: "2.3" },
      );
      expect(facts.externalDocumentReferences).toEqual(
        document !== "NOASSERTION" && id.startsWith("DocumentRef-") ? [id] : [],
      );
      const finding = evaluateBsiProfile(facts).findings.find(
        (item) => item.code === "BSI-2.0.0-5.2.2-DEPENDENCIES",
      );
      expect(finding?.severity).toBe(severity);
    },
  );

  it("keeps native SPDX file/URI facts but excludes license placeholders", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        creationInfo: {
          creators: ["Organization: Contact (https://creator.test)"],
          created: "2026-09-28T00:00:00Z",
        },
        externalDocumentRefs: [{ spdxDocument: "https://external.test/sbom" }],
        files: [
          {
            SPDXID: "f",
            fileName: "C:\\dir\\f.exe",
            licenseConcluded: "NOASSERTION",
            checksums: [{ algorithm: "SHA256", checksumValue: "bad" }],
          },
        ],
        packages: [
          {
            SPDXID: "p",
            name: "p",
            sourceInfo: "https://src.test/repo",
            downloadLocation: "https://dist.test/p",
            externalRefs: [{ referenceLocator: "pkg:npm/p@1" }],
            licenseDeclared: "NONE",
          },
        ],
        relationships: [
          {
            spdxElementId: "p",
            relationshipType: "DEPENDENCY_OF",
            relatedSpdxElement: "f",
          },
          {
            spdxElementId: "f",
            relationshipType: "DESCRIBES",
            relatedSpdxElement: "p",
          },
        ],
      }),
      { ...opts, format: "spdx", specificationVersion: "2.3" },
    );
    expect(facts.primaryComponentReference).toBe("p");
    expect(facts.components[0]).toMatchObject({
      filename: "f.exe",
      concludedLicenses: [],
      sha512: [],
      dependencies: ["p"],
    });
    expect(facts.components[1]).toMatchObject({
      sourceCodeUris: ["https://src.test/repo"],
      deployableUris: ["https://dist.test/p"],
      identifiers: ["pkg:npm/p@1"],
      declaredLicenses: [],
    });
    expect(facts.externalBomLinks).toEqual(["https://external.test/sbom"]);
  });
  it("does not approve ambiguous repeated dependency entries", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        components: [{ "bom-ref": "a", name: "a" }],
        dependencies: [
          { ref: "a", dependsOn: [] },
          { ref: "a", dependsOn: ["b"] },
        ],
      }),
      opts,
    );
    expect(facts.components[0]?.dependencies).toBeNull();
    expect(facts.limitations.join(" ")).toContain("repeated dependency");
  });
  it("keeps SPDX3 ambiguous catalogs unknown and never resurrects a third creation record", async () => {
    const graph = [
      {
        type: "SpdxDocument",
        spdxId: "https://sbom.test",
        creationInfo: "c",
        rootElement: ["sbom"],
      },
      { type: "software_Sbom", spdxId: "sbom", rootElement: ["p"] },
      {
        type: "software_Package",
        spdxId: "p",
        name: "p",
        originatedBy: ["author", "missing"],
        verifiedUsing: ["hash", "missing"],
      },
      { type: "Person", spdxId: "author", name: "one@example.test" },
      { type: "Person", spdxId: "author", name: "two@example.test" },
      {
        type: "Hash",
        spdxId: "hash",
        algorithm: "sha512",
        hashValue: "a".repeat(128),
      },
      {
        type: "Hash",
        spdxId: "hash",
        algorithm: "sha512",
        hashValue: "b".repeat(128),
      },
      {
        type: "CreationInfo",
        "@id": "c",
        created: "2026-09-28T00:00:00Z",
        createdBy: ["author"],
      },
      {
        type: "CreationInfo",
        "@id": "c",
        created: "2026-09-29T00:00:00Z",
        createdBy: ["author"],
      },
      {
        type: "CreationInfo",
        "@id": "c",
        created: "2026-09-30T00:00:00Z",
        createdBy: ["author"],
      },
      { type: "security_Vulnerability", spdxId: "v" },
      {
        type: "Relationship",
        from: "p",
        to: [],
        relationshipType: "dependsOn",
      },
    ];
    const facts = await extractBsiProfileFacts(input({ "@graph": graph }), {
      ...opts,
      format: "spdx",
      serialization: "json_ld",
      specificationVersion: "3.0.1",
    });
    expect(facts.primaryComponentReference).toBe("p");
    expect(facts.timestamp).toBeNull();
    expect(facts.creatorContacts).toEqual([]);
    expect(facts.components[0]).toMatchObject({
      creatorContacts: [],
      sha512: [],
      dependencies: null,
    });
    expect(facts.embeddedVulnerabilityInformation).toBe(true);
    expect(facts.limitations.length).toBeGreaterThan(0);
  });
  it("bounds retained facts and extra graph records", async () => {
    await expect(
      extractBsiProfileFacts(input({ components: [{ name: "a" }] }), {
        ...opts,
        maximumBytes: 100,
      }),
    ).rejects.toThrow("retained fact");
    await expect(
      extractBsiProfileFacts(
        input({
          "@graph": Array.from({ length: 1011 }, (_, i) => ({
            type: "Tool",
            name: `tool${i}`,
          })),
        }),
        { ...opts, maximumComponents: 1 },
      ),
    ).rejects.toThrow("record ceiling");
  });
  it("preserves native source-distribution links separately", async () => {
    const facts = await extractBsiProfileFacts(
      input({
        components: [
          {
            name: "a",
            externalReferences: [
              { type: "source-distribution", url: "https://src.test/a" },
              { type: "distribution", url: "NOASSERTION" },
            ],
          },
        ],
      }),
      opts,
    );
    expect(facts.components[0]?.sourceCodeUris).toEqual(["https://src.test/a"]);
    expect(facts.components[0]?.deployableUris).toEqual([]);
  });
  it("bounds malformed XML lexical buffers, depth and captured text", async () => {
    await expect(
      extractBsiProfileFacts(
        Readable.from([
          Buffer.from('<bom attribute="' + "x".repeat(64 * 1024 + 1)),
        ]),
        { ...opts, serialization: "xml" },
      ),
    ).rejects.toThrow("token ceiling");
    await expect(
      extractBsiProfileFacts(
        Readable.from([
          Buffer.from(
            "<bom>" + "<a>".repeat(257) + "</a>".repeat(257) + "</bom>",
          ),
        ]),
        { ...opts, serialization: "xml" },
      ),
    ).rejects.toThrow("structure ceiling");
    await expect(
      extractBsiProfileFacts(
        Readable.from([
          Buffer.from(
            "<bom><components><component><name>" +
              "x".repeat(1024 * 1024 + 1) +
              "</name></component></components></bom>",
          ),
        ]),
        { ...opts, serialization: "xml" },
      ),
    ).rejects.toThrow("ceiling");
  });
});
