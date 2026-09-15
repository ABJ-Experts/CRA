import { join } from "node:path";
import { createHash } from "node:crypto";

export const VALIDATOR_NAME = "CRA deterministic SBOM validator";
export const VALIDATOR_VERSION = "m3-02.2026-08-21.1";
export const SCHEMA_ASSET_ROOT = join(__dirname, "assets");

export type SchemaAssetManifestEntry = Readonly<{
  id: string;
  path: string;
  upstreamUrl: string;
  upstreamRef: string;
  sha256: string;
  validatorVersion: string;
}>;

export const SCHEMA_ASSET_MANIFEST = Object.freeze([
  {
    id: "cyclonedx-1.4-json",
    path: "cyclonedx/bom-1.4.schema.json",
    upstreamUrl:
      "https://raw.githubusercontent.com/CycloneDX/specification/1.4/schema/bom-1.4.schema.json",
    upstreamRef: "CycloneDX/specification tag 1.4",
    sha256: "51b79463558376e6397802cce4fd792037a941cda89f9a7cc0abd1b5cbeb67b7",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "cyclonedx-1.4-xml",
    path: "cyclonedx/bom-1.4.xsd",
    upstreamUrl:
      "https://raw.githubusercontent.com/CycloneDX/specification/1.4/schema/bom-1.4.xsd",
    upstreamRef: "CycloneDX/specification tag 1.4",
    sha256: "d2c58c5964fd4c9ccdd59f08fd102bb7ee8f7ea956c99b7834d8d45ca2fba938",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "cyclonedx-1.5-json",
    path: "cyclonedx/bom-1.5.schema.json",
    upstreamUrl:
      "https://raw.githubusercontent.com/CycloneDX/specification/1.5/schema/bom-1.5.schema.json",
    upstreamRef: "CycloneDX/specification tag 1.5",
    sha256: "067f7824b08653839ea050ae9e09ca48375eadc2652b0e2a299476e7db90335b",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "cyclonedx-1.5-xml",
    path: "cyclonedx/bom-1.5.xsd",
    upstreamUrl:
      "https://raw.githubusercontent.com/CycloneDX/specification/1.5/schema/bom-1.5.xsd",
    upstreamRef: "CycloneDX/specification tag 1.5",
    sha256: "ef27af4cbc6dc7dd7e7211b77d9768394be8f54514cc99e9b13b07c305502eb8",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "cyclonedx-1.6-json",
    path: "cyclonedx/bom-1.6.schema.json",
    upstreamUrl:
      "https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/bom-1.6.schema.json",
    upstreamRef: "CycloneDX/specification tag 1.6",
    sha256: "3e92dddbc30cf7f6a02b80f0942b1a4cfd4fb1c26f1dfc4310afa9d613cafb93",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "cyclonedx-1.6-xml",
    path: "cyclonedx/bom-1.6.xsd",
    upstreamUrl:
      "https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/bom-1.6.xsd",
    upstreamRef: "CycloneDX/specification tag 1.6",
    sha256: "cec528b86a638c8aebb0c326648d40d6f24813e61db4204f47cb82ac93d856a9",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "cyclonedx-spdx-license-json",
    path: "cyclonedx/spdx.schema.json",
    upstreamUrl:
      "https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/spdx.schema.json",
    upstreamRef: "CycloneDX/specification tag 1.6 companion schema",
    sha256: "baa9d3bd1ed57b6751b0887edead6b5063ff53ff7429cf85d476c6c94af0166e",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "cyclonedx-jsf-json",
    path: "cyclonedx/jsf-0.82.schema.json",
    upstreamUrl:
      "https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/jsf-0.82.schema.json",
    upstreamRef: "CycloneDX/specification tag 1.6 companion schema",
    sha256: "8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "spdx-2.2-json",
    path: "spdx/spdx-2.2.schema.json",
    upstreamUrl:
      "https://raw.githubusercontent.com/spdx/spdx-spec/v2.2.2/schemas/spdx-schema.json",
    upstreamRef: "spdx/spdx-spec tag v2.2.2 for SPDX 2.2 JSON",
    sha256: "c8328d14c33621a6be917569ad4c323d370220412edbaddc37ccf1e93e3ca88a",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "spdx-2.3-json",
    path: "spdx/spdx-2.3.schema.json",
    upstreamUrl:
      "https://raw.githubusercontent.com/spdx/spdx-spec/v2.3/schemas/spdx-schema.json",
    upstreamRef: "spdx/spdx-spec tag v2.3",
    sha256: "239208b7ac287b3cf5d9a9af23f9d69863971102a5e1587a27a398b43490b89b",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "spdx-3.0-jsonld-context",
    path: "spdx/spdx-3.0.context.jsonld",
    upstreamUrl:
      "https://raw.githubusercontent.com/spdx/spdx-spec/3.0.1/rdf/spdx-context.jsonld",
    upstreamRef: "spdx/spdx-spec tag 3.0.1 JSON-LD context for SPDX 3.0 family",
    sha256: "c72b0928f094c83e5c127784edb1ebca2af74a104fcacc007c332b23cbc788bd",
    validatorVersion: VALIDATOR_VERSION,
  },
  {
    id: "spdx-3.0-jsonld-example",
    path: "spdx/spdx-3.0.package-sbom.example.json",
    upstreamUrl:
      "https://raw.githubusercontent.com/spdx/spdx-spec/v3.0/examples/jsonld/package_sbom.json",
    upstreamRef: "spdx/spdx-spec tag v3.0",
    sha256: "591cd9bc4006da96c0ec996241f753cc1569790fc5747368552d94addc5211bd",
    validatorVersion: VALIDATOR_VERSION,
  },
] satisfies readonly SchemaAssetManifestEntry[]);

export const SCHEMA_MANIFEST_SHA256 = createHash("sha256")
  .update(
    JSON.stringify(
      SCHEMA_ASSET_MANIFEST.map((asset) => ({
        id: asset.id,
        sha256: asset.sha256,
        validatorVersion: asset.validatorVersion,
      })),
    ),
  )
  .digest("hex");

export function schemaAssetSha256ForDetection(
  input: Readonly<{
    format: "cyclonedx" | "spdx" | null;
    serialization: "json" | "xml" | "tag_value" | null;
    version: string | null;
  }>,
): string {
  if (input.format === "cyclonedx" && input.version) {
    const suffix = input.serialization === "xml" ? "xml" : "json";
    return (
      SCHEMA_ASSET_MANIFEST.find(
        (asset) => asset.id === `cyclonedx-${input.version}-${suffix}`,
      )?.sha256 ?? SCHEMA_MANIFEST_SHA256
    );
  }
  if (input.format === "spdx" && input.serialization === "json") {
    return (
      SCHEMA_ASSET_MANIFEST.find(
        (asset) => asset.id === `spdx-${input.version}-json`,
      )?.sha256 ??
      SCHEMA_ASSET_MANIFEST.find(
        (asset) => asset.id === "spdx-3.0-jsonld-context",
      )?.sha256 ??
      SCHEMA_MANIFEST_SHA256
    );
  }
  return SCHEMA_MANIFEST_SHA256;
}
