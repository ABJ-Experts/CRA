import { describe, it, expect } from "vitest";
import { parseSbom, detectFormat, parserFor } from "./index";
import { SbomParseError } from "./model";

const CYCLONEDX = JSON.stringify({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: "urn:uuid:abc",
  metadata: { component: { "bom-ref": "root", name: "app" } },
  components: [
    {
      type: "library",
      "bom-ref": "c-lodash",
      name: "lodash",
      version: "4.17.20",
      purl: "pkg:npm/lodash@4.17.20",
      scope: "required",
    },
    {
      type: "library",
      "bom-ref": "c-express",
      name: "express",
      version: "4.18.2",
      purl: "pkg:npm/express@4.18.2",
    },
    {
      type: "library",
      "bom-ref": "c-openssl",
      name: "openssl",
      version: "1.1.1w",
      cpe: "cpe:2.3:a:openssl:openssl:1.1.1w:*:*:*:*:*:*:*",
    },
  ],
  dependencies: [
    { ref: "root", dependsOn: ["c-lodash", "c-express"] },
    { ref: "c-express", dependsOn: ["c-openssl"] },
  ],
});

const SPDX = JSON.stringify({
  spdxVersion: "SPDX-2.3",
  documentNamespace: "https://example/spdx",
  packages: [
    { SPDXID: "SPDXRef-root", name: "app", versionInfo: "1.0" },
    {
      SPDXID: "SPDXRef-lodash",
      name: "lodash",
      versionInfo: "4.17.20",
      externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/lodash@4.17.20" }],
    },
  ],
  relationships: [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: "SPDXRef-root",
    },
    {
      spdxElementId: "SPDXRef-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-lodash",
    },
  ],
});

const CYCLONEDX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1" serialNumber="urn:uuid:xml">
  <metadata><component bom-ref="root"><name>app</name><version>1.0.0</version></component></metadata>
  <components>
    <component type="library" bom-ref="c-lodash">
      <name>lodash</name><version>4.17.20</version><purl>pkg:npm/lodash@4.17.20</purl>
    </component>
  </components>
  <dependencies><dependency ref="root"><dependency ref="c-lodash" /></dependency></dependencies>
</bom>`;

const SPDX_TAG_VALUE = `SPDXVersion: SPDX-2.3
DataLicense: CC0-1.0
SPDXID: SPDXRef-DOCUMENT
DocumentNamespace: https://example/spdx-tag

PackageName: lodash
SPDXID: SPDXRef-lodash
PackageVersion: 4.17.20
ExternalRef: PACKAGE-MANAGER purl pkg:npm/lodash@4.17.20

Relationship: SPDXRef-DOCUMENT DESCRIBES SPDXRef-lodash
`;

const SPDX_3_JSON = JSON.stringify({
  spdxVersion: "SPDX-3.0",
  documentNamespace: "https://example/spdx-3",
  "@graph": [
    {
      "@id": "urn:spdx:package:lodash",
      type: "SoftwarePackage",
      name: "lodash",
      softwarePackageVersion: "4.17.20",
      externalIdentifier: [
        { externalIdentifierType: "packageUrl", identifier: "pkg:npm/lodash@4.17.20" },
      ],
    },
  ],
});

describe("format detection + factory", () => {
  it("detects CycloneDX and SPDX", () => {
    expect(detectFormat(CYCLONEDX)).toBe("cyclonedx");
    expect(detectFormat(SPDX)).toBe("spdx");
    expect(detectFormat("not json")).toBeNull();
  });
  it("detects CycloneDX XML and SPDX tag-value", () => {
    expect(detectFormat(CYCLONEDX_XML)).toBe("cyclonedx");
    expect(detectFormat(SPDX_TAG_VALUE)).toBe("spdx");
  });
  it("parserFor returns the matching adapter", () => {
    expect(parserFor("cyclonedx").format).toBe("cyclonedx");
    expect(parserFor("spdx").format).toBe("spdx");
  });
});

describe("FR-SBOM-007 — CycloneDX normalisation", () => {
  const sbom = parseSbom(CYCLONEDX);
  it("normalises components with purl, ecosystem and version", () => {
    expect(sbom.specVersion).toBe("1.5");
    expect(sbom.componentCount).toBe(3);
    const lodash = sbom.components.find((c) => c.name === "lodash");
    expect(lodash?.purl).toBe("pkg:npm/lodash@4.17.20");
    expect(lodash?.ecosystem).toBe("semver");
    expect(lodash?.versionNormalised).toBe("4.17.20");
    expect(lodash?.scope).toBe("required");
  });
  it("computes dependency depth (0 = top-level, transitive deeper)", () => {
    const byName = Object.fromEntries(sbom.components.map((c) => [c.name, c.depth]));
    expect(byName.lodash).toBe(0);
    expect(byName.express).toBe(0);
    expect(byName.openssl).toBe(1);
    expect(sbom.depthMax).toBe(1);
  });
  it("keeps CPE for components without a PURL", () => {
    const openssl = sbom.components.find((c) => c.name === "openssl");
    expect(openssl?.cpe).toContain("cpe:2.3:a:openssl");
    expect(openssl?.purl).toBeNull();
  });
});

describe("FR-SBOM-001 — SPDX 2.3 normalisation", () => {
  const sbom = parseSbom(SPDX);
  it("extracts purl from externalRefs and resolves ecosystem", () => {
    expect(sbom.format).toBe("spdx");
    const lodash = sbom.components.find((c) => c.name === "lodash");
    expect(lodash?.purl).toBe("pkg:npm/lodash@4.17.20");
    expect(lodash?.ecosystem).toBe("semver");
    expect(lodash?.depth).toBe(0);
  });
});

describe("FR-SBOM-001 — XML and tag-value formats", () => {
  it("normalises CycloneDX XML 1.6", () => {
    const sbom = parseSbom(CYCLONEDX_XML);
    expect(sbom).toMatchObject({ format: "cyclonedx", specVersion: "1.6", componentCount: 1 });
    expect(sbom.components[0]).toMatchObject({
      name: "lodash",
      purl: "pkg:npm/lodash@4.17.20",
      depth: 0,
    });
  });

  it("normalises SPDX tag-value with package-manager PURL", () => {
    const sbom = parseSbom(SPDX_TAG_VALUE);
    expect(sbom).toMatchObject({ format: "spdx", specVersion: "2.3", componentCount: 1 });
    expect(sbom.components[0]).toMatchObject({
      name: "lodash",
      purl: "pkg:npm/lodash@4.17.20",
      depth: 0,
    });
  });

  it("normalises SPDX 3.0 JSON-LD software packages", () => {
    const sbom = parseSbom(SPDX_3_JSON);
    expect(sbom).toMatchObject({ format: "spdx", specVersion: "3.0", componentCount: 1 });
    expect(sbom.components[0]).toMatchObject({ name: "lodash", purl: "pkg:npm/lodash@4.17.20" });
  });
});

describe("FR-SBOM-004 — invalid input is reported, never guessed", () => {
  it("throws SbomParseError on unrecognised input", () => {
    expect(() => parseSbom("<xml/>")).toThrow(SbomParseError);
  });
  it("throws on malformed CycloneDX JSON", () => {
    expect(() => parserFor("cyclonedx").parse("{ not json")).toThrow(SbomParseError);
  });
});
