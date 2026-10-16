import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sbomValidationReportSchema } from "@repo/contracts/sboms";

import { VALIDATION_POLICY } from "./sbom-validation-policy";
import {
  collectCycloneDxXmlProviderDiagnostics,
  SbomValidationInfrastructureError,
  validateSbom,
} from "./sbom-validator";

const fixtureRoot = join(__dirname, "fixtures");

type ExpectedFixture = Readonly<{
  fileName: string;
  mediaType: string;
  format: "cyclonedx" | "spdx";
  serialization: "json" | "xml" | "tag_value";
  version: string;
}>;

const validFixtures: readonly ExpectedFixture[] = Object.freeze([
  {
    fileName: "cyclonedx-1.4.json",
    mediaType: "application/vnd.cyclonedx+json",
    format: "cyclonedx",
    serialization: "json",
    version: "1.4",
  },
  {
    fileName: "cyclonedx-1.4.xml",
    mediaType: "application/vnd.cyclonedx+xml",
    format: "cyclonedx",
    serialization: "xml",
    version: "1.4",
  },
  {
    fileName: "cyclonedx-1.5.json",
    mediaType: "application/vnd.cyclonedx+json",
    format: "cyclonedx",
    serialization: "json",
    version: "1.5",
  },
  {
    fileName: "cyclonedx-1.5.xml",
    mediaType: "application/vnd.cyclonedx+xml",
    format: "cyclonedx",
    serialization: "xml",
    version: "1.5",
  },
  {
    fileName: "cyclonedx-1.6.json",
    mediaType: "application/vnd.cyclonedx+json",
    format: "cyclonedx",
    serialization: "json",
    version: "1.6",
  },
  {
    fileName: "cyclonedx-1.6.xml",
    mediaType: "application/vnd.cyclonedx+xml",
    format: "cyclonedx",
    serialization: "xml",
    version: "1.6",
  },
  {
    fileName: "spdx-2.2.json",
    mediaType: "application/spdx+json",
    format: "spdx",
    serialization: "json",
    version: "2.2",
  },
  {
    fileName: "spdx-2.2.spdx",
    mediaType: "text/plain",
    format: "spdx",
    serialization: "tag_value",
    version: "2.2",
  },
  {
    fileName: "spdx-2.3.json",
    mediaType: "application/spdx+json",
    format: "spdx",
    serialization: "json",
    version: "2.3",
  },
  {
    fileName: "spdx-2.3.spdx",
    mediaType: "text/plain",
    format: "spdx",
    serialization: "tag_value",
    version: "2.3",
  },
  {
    fileName: "spdx-3.0.json",
    mediaType: "application/spdx+json",
    format: "spdx",
    serialization: "json",
    version: "3.0",
  },
]);

describe("validateSbom", () => {
  it.each(validFixtures)(
    "accepts the curated valid corpus fixture $fileName",
    async ({ fileName, mediaType, format, serialization, version }) => {
      const report = await validateSbom({
        bytes: readFixture(fileName),
        fileName,
        mediaType,
      });

      expect(sbomValidationReportSchema.parse(report)).toEqual(report);
      expect(report).toMatchObject({
        status: "valid",
        detected: {
          format: format,
          serialization: serialization,
          specificationVersion: version,
        },
        errorCount: 0,
        warningCount: 0,
        omittedDiagnosticCount: 0,
      });
    },
  );

  it("is deterministic for identical bytes and validator version", async () => {
    const bytes = readFixture("cyclonedx-1.6.json");

    const first = await validateSbom({ bytes });
    await expect(validateSbom({ bytes })).resolves.toEqual(first);
    expect(first.completedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("sniffs content after a UTF-8 BOM and reports metadata mismatches as warnings", async () => {
    const report = await validateSbom({
      bytes: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        readFixture("cyclonedx-1.6.json"),
      ]),
      declaredFormat: "spdx",
      declaredSpecVersion: "2.3",
      fileName: "declared.spdx",
      mediaType: "application/spdx+json",
    });

    expect(report.status).toBe("valid_with_warnings");
    expect(report.detected).toMatchObject({
      format: "cyclonedx",
      serialization: "json",
    });
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "declared_format_mismatch",
      "declared_spec_version_mismatch",
      "extension_mismatch",
      "media_type_mismatch",
    ]);
    expect({ error: report.errorCount, warning: report.warningCount }).toEqual({
      error: 0,
      warning: 4,
    });
  });

  it("rejects malformed or non-UTF8 input before parsing", async () => {
    const report = await validateSbom({
      bytes: Buffer.from([0xff, 0xfe, 0x00, 0x00]),
      fileName: "bad.json",
      mediaType: "application/json",
    });

    expect(report).toMatchObject({
      status: "invalid",
      detected: null,
      errorCount: 1,
      warningCount: 0,
    });
    expect(report.diagnostics[0]).toMatchObject({
      code: "invalid_utf8",
      location: "$",
    });
  });

  it("hard-stops before decoding, sniffing, or provider validation over the byte ceiling", async () => {
    await expect(
      validateSbom(
        {
          bytes: Buffer.from([0xff, 0xfe]),
          fileName: "oversized.json",
          mediaType: "application/json",
        },
        { policy: { ...VALIDATION_POLICY, maximumBytes: 1 } },
      ),
    ).resolves.toMatchObject({
      status: "invalid",
      detected: null,
      diagnostics: [expect.objectContaining({ code: "byte_limit_exceeded" })],
      errorCount: 1,
      warningCount: 0,
    });

    const validateCycloneDxXml = jest.fn().mockResolvedValue([]);
    const xmlReport = await validateSbom(
      {
        bytes: Buffer.from(
          '<bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1" />',
          "utf8",
        ),
        fileName: "oversized.xml",
        mediaType: "application/vnd.cyclonedx+xml",
      },
      {
        policy: { ...VALIDATION_POLICY, maximumBytes: 1 },
        validateCycloneDxXml,
      },
    );

    expect(validateCycloneDxXml).not.toHaveBeenCalled();
    expect(xmlReport).toMatchObject({
      status: "invalid",
      detected: null,
      diagnostics: [expect.objectContaining({ code: "byte_limit_exceeded" })],
      errorCount: 1,
      warningCount: 0,
    });
  });

  it("rejects unsafe XML before the CycloneDX XML validator is invoked", async () => {
    const validateCycloneDxXml = jest.fn();
    const report = await validateSbom(
      {
        bytes: Buffer.from(
          '<!DOCTYPE bom [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1"><metadata><timestamp>2026-08-21T00:00:00Z</timestamp></metadata></bom>',
          "utf8",
        ),
        fileName: "unsafe.xml",
        mediaType: "application/vnd.cyclonedx+xml",
      },
      { validateCycloneDxXml },
    );

    expect(validateCycloneDxXml).not.toHaveBeenCalled();
    expect(report.status).toBe("invalid");
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unsafe_xml_doctype",
      "unsafe_xml_entity",
      "unsafe_xml_external_resource",
    ]);
  });

  it("rejects descendant XML default namespace changes before the XML validator", async () => {
    const validateCycloneDxXml = jest.fn().mockResolvedValue([]);
    const report = await validateSbom(
      {
        bytes: Buffer.from(
          '<bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1"><components><component xmlns="urn:evil" type="library"><name>evil</name></component></components></bom>',
          "utf8",
        ),
        fileName: "namespace.xml",
        mediaType: "application/vnd.cyclonedx+xml",
      },
      { validateCycloneDxXml },
    );

    expect(validateCycloneDxXml).not.toHaveBeenCalled();
    expect(report.status).toBe("invalid");
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unsafe_xml_namespace",
    ]);
  });

  it("does not treat PUBLIC or SYSTEM element text as an external XML resource", async () => {
    const validateCycloneDxXml = jest.fn().mockResolvedValue([]);
    const report = await validateSbom(
      {
        bytes: Buffer.from(
          '<bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1"><components><component type="library"><name>PUBLIC SYSTEM</name></component></components></bom>',
          "utf8",
        ),
        fileName: "public-text.xml",
        mediaType: "application/vnd.cyclonedx+xml",
      },
      { validateCycloneDxXml },
    );

    expect(validateCycloneDxXml).toHaveBeenCalledTimes(1);
    expect(report.status).toBe("valid");
    expect(report.diagnostics).toEqual([]);
  });

  it("rejects prototype-like JSON keys and extreme numeric literals", async () => {
    const report = await validateSbom({
      bytes: Buffer.from(
        '{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"__proto__":{},"metadata":{"timestamp":1e9999}}',
        "utf8",
      ),
      fileName: "prototype.json",
      mediaType: "application/vnd.cyclonedx+json",
    });

    expect(report.status).toBe("invalid");
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "extreme_numeric_literal",
      "prototype_key",
    ]);
  });

  it("rejects duplicate BOM/SPDX IDs and missing required SPDX namespaces", async () => {
    const spdxJson = {
      SPDXID: "SPDXRef-DOCUMENT",
      spdxVersion: "SPDX-2.3",
      creationInfo: {
        created: "2026-08-21T00:00:00Z",
        creators: ["Tool: CRA"],
      },
      dataLicense: "CC0-1.0",
      name: "missing namespace",
      documentDescribes: ["SPDXRef-Package"],
      packages: [
        {
          SPDXID: "SPDXRef-Package",
          name: "a",
          downloadLocation: "NOASSERTION",
          filesAnalyzed: false,
          licenseConcluded: "NOASSERTION",
          licenseDeclared: "NOASSERTION",
          copyrightText: "NOASSERTION",
        },
        {
          SPDXID: "SPDXRef-Package",
          name: "b",
          downloadLocation: "NOASSERTION",
          filesAnalyzed: false,
          licenseConcluded: "NOASSERTION",
          licenseDeclared: "NOASSERTION",
          copyrightText: "NOASSERTION",
        },
      ],
    };

    const report = await validateSbom({
      bytes: Buffer.from(JSON.stringify(spdxJson), "utf8"),
      fileName: "duplicate-spdx.json",
      mediaType: "application/spdx+json",
    });

    expect(report.status).toBe("invalid");
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "duplicate_spdx_id",
      "missing_spdx_namespace",
    ]);
  });

  it("rejects all configured limit breaches with bounded diagnostics", async () => {
    const report = await validateSbom(
      {
        bytes: Buffer.from(
          '{"spdxVersion":"SPDX-2.3","SPDXID":"SPDXRef-DOCUMENT","documentNamespace":"https://example.test/ns","name":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","creationInfo":{"created":"2026-08-21T00:00:00Z","creators":["Tool: CRA"]},"dataLicense":"CC0-1.0"}',
          "utf8",
        ),
        fileName: "limit.json",
        mediaType: "application/spdx+json",
      },
      {
        policy: {
          ...VALIDATION_POLICY,
          maximumBytes: 1024,
          maximumScalarBytes: 8,
          maximumDiagnostics: 2,
        },
      },
    );

    expect(report.status).toBe("invalid");
    expect(report.diagnostics).toHaveLength(2);
    expect(report.omittedDiagnosticCount).toBeGreaterThan(0);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "scalar_limit_exceeded",
      "scalar_limit_exceeded",
    ]);
  });

  it("rejects SPDX 3 non-JSON serialization with stable remediation", async () => {
    const report = await validateSbom({
      bytes: Buffer.from("SPDXVersion: SPDX-3.0\nSPDXID: SPDXRef-DOCUMENT\n"),
      fileName: "spdx-3.spdx",
      mediaType: "text/plain",
      declaredFormat: "spdx",
      declaredSpecVersion: "3.0",
    });

    expect(report).toMatchObject({
      status: "invalid",
      detected: {
        format: "spdx",
        serialization: "tag_value",
        specificationVersion: "3.0",
      },
    });
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unsupported_spdx3_serialization",
        remediation: "Submit SPDX 3 SBOMs as JSON-LD.",
      }),
    );
  });

  it("rejects malformed JSON and unknown content without guessing from metadata", async () => {
    await expect(
      validateSbom({
        bytes: Buffer.from('{"bomFormat":"CycloneDX"', "utf8"),
        fileName: "broken.json",
        mediaType: "application/json",
      }),
    ).resolves.toMatchObject({
      status: "invalid",
      detected: null,
      diagnostics: [expect.objectContaining({ code: "malformed_json" })],
    });

    await expect(
      validateSbom({
        bytes: Buffer.from("not an sbom", "utf8"),
        declaredFormat: "spdx",
        declaredSpecVersion: "2.3",
        fileName: "unknown.txt",
        mediaType: "text/plain",
      }),
    ).resolves.toMatchObject({
      status: "invalid",
      detected: null,
      diagnostics: [
        expect.objectContaining({ code: "unsupported_serialization" }),
      ],
    });
  });

  it("rejects missing and unsupported JSON spec versions deterministically", async () => {
    await expect(
      validateSbom({
        bytes: Buffer.from(
          JSON.stringify({ bomFormat: "CycloneDX", version: 1 }),
          "utf8",
        ),
        fileName: "missing-version.json",
        mediaType: "application/vnd.cyclonedx+json",
      }),
    ).resolves.toMatchObject({
      status: "invalid",
      diagnostics: [expect.objectContaining({ code: "missing_spec_version" })],
    });

    const report = await validateSbom({
      bytes: Buffer.from(
        JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.7",
          version: 1,
        }),
        "utf8",
      ),
      fileName: "unsupported.json",
      mediaType: "application/vnd.cyclonedx+json",
    });

    expect(report.detected?.specificationVersion).toBe("1.7");
    expect(report).toMatchObject({
      status: "invalid",
      diagnostics: [
        expect.objectContaining({ code: "unsupported_spec_version" }),
      ],
    });
  });

  it("rejects duplicate CycloneDX bom-ref values", async () => {
    const document = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      version: 1,
      components: [
        { type: "library", "bom-ref": "duplicate", name: "a" },
        { type: "library", "bom-ref": "duplicate", name: "b" },
      ],
    };

    const report = await validateSbom({
      bytes: Buffer.from(JSON.stringify(document), "utf8"),
      fileName: "duplicate-cdx.json",
      mediaType: "application/vnd.cyclonedx+json",
    });

    expect(report.status).toBe("invalid");
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicate_bom_ref" }),
    );
  });

  it("rejects duplicate SPDX tag-value IDs in the same package section", async () => {
    const report = await validateSbom({
      bytes: Buffer.from(
        [
          "SPDXVersion: SPDX-2.3",
          "DataLicense: CC0-1.0",
          "SPDXID: SPDXRef-DOCUMENT",
          "DocumentName: Example",
          "DocumentNamespace: https://example.test/spdx",
          "Creator: Tool: CRA",
          "Created: 2026-08-21T00:00:00Z",
          "PackageName: package",
          "SPDXID: SPDXRef-Package",
          "SPDXID: SPDXRef-Package",
          "PackageDownloadLocation: NOASSERTION",
          "FilesAnalyzed: false",
          "PackageLicenseConcluded: NOASSERTION",
          "PackageLicenseDeclared: NOASSERTION",
          "PackageCopyrightText: NOASSERTION",
        ].join("\n"),
        "utf8",
      ),
      fileName: "duplicate-id.spdx",
      mediaType: "text/plain",
    });

    expect(report.status).toBe("invalid");
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_spdx_id",
          location: "line:10",
        }),
        expect.objectContaining({
          code: "duplicate_spdx_tag",
          location: "line:10",
        }),
      ]),
    );
  });

  it("reports malformed XML and rejects schema-location or namespace inputs", async () => {
    await expect(
      validateSbom({
        bytes: Buffer.from(
          '<bom xmlns="http://cyclonedx.org/schema/bom/1.6"',
          "utf8",
        ),
        fileName: "broken.xml",
        mediaType: "application/vnd.cyclonedx+xml",
      }),
    ).resolves.toMatchObject({
      status: "invalid",
      diagnostics: [expect.objectContaining({ code: "malformed_xml" })],
    });

    const unsafe = await validateSbom({
      bytes: Buffer.from(
        '<bom xmlns="http://cyclonedx.org/schema/bom/1.6" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://example.test schema.xsd" version="1" />',
        "utf8",
      ),
      fileName: "unsafe.xml",
      mediaType: "application/vnd.cyclonedx+xml",
    });

    expect(unsafe.diagnostics.map((item) => item.code)).toEqual([
      "unsafe_xml_schema_location",
    ]);
  });

  it("rejects XML depth, token, attribute, and scalar limit breaches", async () => {
    const report = await validateSbom(
      {
        bytes: Buffer.from(
          '<bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1"><metadata a="1" b="222222"><timestamp>123456789</timestamp></metadata></bom>',
          "utf8",
        ),
        fileName: "limits.xml",
        mediaType: "application/vnd.cyclonedx+xml",
      },
      {
        policy: {
          ...VALIDATION_POLICY,
          maximumAttributesPerElement: 1,
          maximumDepth: 1,
          maximumScalarBytes: 4,
          maximumTokens: 1,
          maximumTotalAttributeBytes: 4,
        },
      },
    );

    expect(report.status).toBe("invalid");
    expect(report.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "attribute_bytes_limit_exceeded",
        "attribute_limit_exceeded",
        "depth_limit_exceeded",
        "scalar_limit_exceeded",
        "token_limit_exceeded",
      ]),
    );
  });

  it("propagates CycloneDX XML provider unavailability as infrastructure", async () => {
    await expect(
      validateSbom(
        {
          bytes: readFixture("cyclonedx-1.6.xml"),
          fileName: "cyclonedx-1.6.xml",
          mediaType: "application/vnd.cyclonedx+xml",
        },
        {
          validateCycloneDxXml: () => {
            throw new SbomValidationInfrastructureError(
              "validator_unavailable",
              "provider unavailable",
            );
          },
        },
      ),
    ).rejects.toThrow(SbomValidationInfrastructureError);
  });

  it("stops Ajv at the first schema diagnostic instead of materializing repeated failures", async () => {
    const report = await validateSbom(
      {
        bytes: Buffer.from(
          JSON.stringify({
            bomFormat: "CycloneDX",
            specVersion: "1.6",
            version: 1,
            components: Array.from({ length: 250 }, () => ({})),
          }),
          "utf8",
        ),
        fileName: "many-schema-errors.json",
        mediaType: "application/vnd.cyclonedx+json",
      },
      {
        policy: { ...VALIDATION_POLICY, maximumDiagnostics: 1 },
      },
    );

    expect(report.status).toBe("invalid");
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "schema_violation",
    });
    // An omitted count here would prove that Ajv allocated a large `errors`
    // array before the report collector got a chance to cap it.
    expect(report.omittedDiagnosticCount).toBe(0);
  });

  it("stops consuming an unknown XML provider diagnostic stream at the report bound", () => {
    let consumed = 0;
    const unboundedErrors: Iterable<unknown> = {
      *[Symbol.iterator]() {
        for (;;) {
          consumed += 1;
          yield { line: consumed, column: 1, message: "invalid component" };
        }
      },
    };

    const result = collectCycloneDxXmlProviderDiagnostics(unboundedErrors, 1);

    expect(consumed).toBe(1);
    expect(result).toEqual({
      diagnostics: [
        expect.objectContaining({
          code: "schema_violation",
          location: "line:1:column:1",
        }),
      ],
      // An unknown source cardinality must not be guessed as omitted.
      omittedDiagnosticCount: 0,
    });
  });

  it("reports an exact omission count for an indexed XML provider error source", () => {
    const result = collectCycloneDxXmlProviderDiagnostics(
      Array.from({ length: 3 }, (_, index) => ({
        line: index + 1,
        message: "invalid component",
      })),
      1,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.omittedDiagnosticCount).toBe(2);
  });

  it("rejects incomplete SPDX 3 JSON-LD shape", async () => {
    const report = await validateSbom({
      bytes: Buffer.from(
        JSON.stringify({
          "@context": "https://spdx.org/rdf/3.0.0/spdx-context.jsonld",
        }),
        "utf8",
      ),
      fileName: "spdx3.json",
      mediaType: "application/spdx+json",
    });

    expect(report.status).toBe("invalid");
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_spdx3_graph" }),
        expect.objectContaining({ code: "missing_spdx3_creation_info" }),
        expect.objectContaining({ code: "missing_spdx3_document" }),
        expect.objectContaining({ code: "missing_spdx3_sbom" }),
      ]),
    );
  });

  it("rejects SPDX 3 JSON-LD that does not use the pinned official context and profile", async () => {
    const report = await validateSbom({
      bytes: Buffer.from(
        JSON.stringify({
          "@context": "https://not-spdx.example/context",
          "@graph": [
            { type: "CreationInfo", specVersion: "3.0" },
            { type: "SpdxDocument" },
          ],
        }),
        "utf8",
      ),
      fileName: "loose-spdx3.json",
      mediaType: "application/spdx+json",
    });

    expect(report.status).toBe("invalid");
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_spdx3_context" }),
        expect.objectContaining({ code: "missing_spdx3_creation_info_id" }),
        expect.objectContaining({ code: "missing_spdx3_document_id" }),
        expect.objectContaining({ code: "missing_spdx3_profile_conformance" }),
        expect.objectContaining({ code: "missing_spdx3_sbom" }),
      ]),
    );
  });

  it("rejects SPDX 3 JSON-LD terms outside the pinned local context", async () => {
    const value = JSON.parse(readFixture("spdx-3.0.json").toString("utf8")) as {
      "@graph": Array<Record<string, unknown>>;
    };
    const report = await validateSbom({
      bytes: Buffer.from(
        JSON.stringify({
          ...value,
          "@graph": value["@graph"].map((item, index) =>
            index === 4 ? { ...item, evilTerm: true } : item,
          ),
        }),
        "utf8",
      ),
      fileName: "unknown-term-spdx3.json",
      mediaType: "application/spdx+json",
    });

    expect(report.status).toBe("invalid");
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unsupported_spdx3_term",
        location: "$.@graph[4].evilTerm",
      }),
    );
  });

  it("rejects malformed SPDX 3 JSON-LD graph items and unresolved local references", async () => {
    const report = await validateSbom({
      bytes: Buffer.from(
        JSON.stringify({
          "@context": "https://spdx.org/rdf/3.0.0/spdx-context.jsonld",
          "@graph": [
            {
              type: "CreationInfo",
              "@id": "_:creationinfo",
              createdBy: ["https://example.test/missing-agent"],
              specVersion: "3.0.0",
              created: "2026-08-21T00:00:00Z",
            },
            {
              type: "SpdxDocument",
              spdxId: "https://example.test/document",
              creationInfo: "_:missing",
              rootElement: ["https://example.test/missing-sbom"],
              profileConformance: ["core"],
            },
            "not an object",
            {
              type: "software_Sbom",
              spdxId: "https://example.test/sbom",
              creationInfo: "_:creationinfo",
              rootElement: [],
              software_sbomType: [],
            },
            {
              type: "software_Package",
              spdxId: "https://example.test/package",
              creationInfo: "_:creationinfo",
              software_downloadLocation: "NOASSERTION",
            },
          ],
        }),
        "utf8",
      ),
      fileName: "broken-profile-spdx3.json",
      mediaType: "application/spdx+json",
    });

    expect(report.status).toBe("invalid");
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_spdx3_graph_item" }),
        expect.objectContaining({
          code: "invalid_spdx3_creation_info_reference",
        }),
        expect.objectContaining({ code: "invalid_spdx3_reference" }),
        expect.objectContaining({ code: "missing_spdx3_package_name" }),
        expect.objectContaining({ code: "missing_spdx3_profile_conformance" }),
        expect.objectContaining({ code: "missing_spdx3_sbom_root" }),
        expect.objectContaining({ code: "missing_spdx3_sbom_type" }),
      ]),
    );
  });
});

function readFixture(fileName: string): Buffer {
  return readFileSync(join(fixtureRoot, fileName));
}
