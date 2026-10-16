import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { SCHEMA_ASSET_ROOT } from "../../sboms/validation/schema-manifest";

export type VexExportFormat = "openvex" | "cyclonedx-vex";

export type VexValidationResult = Readonly<{
  valid: boolean;
  schemaSha256: string;
  diagnostics: readonly Readonly<{ path: string; message: string }>[];
}>;

export class VexExportValidationError extends Error {
  constructor(readonly format: VexExportFormat) {
    super(`${format} export validation failed.`);
  }
}

const OPENVEX_SCHEMA_PATH = join(
  __dirname,
  "assets",
  "openvex-0.2.0.schema.json",
);

/** Official OpenVEX 0.2.0 schema, vendored at the immutable upstream blob. */
export const OPENVEX_020_SCHEMA_ASSET = Object.freeze({
  specificationVersion: "0.2.0",
  upstreamUrl:
    "https://api.github.com/repos/openvex/spec/git/blobs/2a6aecb81ad26393c2f173bf70e5280e3dc4f1e8",
  upstreamRef:
    "openvex/spec immutable schema blob 2a6aecb81ad26393c2f173bf70e5280e3dc4f1e8",
  sha256: "bc56e6ce530a2409593be707da4c052f6b546ee3e52537ff7f51076d36949269",
});
const CYCLONEDX_SCHEMA_PATH = join(
  SCHEMA_ASSET_ROOT,
  "cyclonedx",
  "bom-1.6.schema.json",
);
const CYCLONEDX_SPDX_SCHEMA_PATH = join(
  SCHEMA_ASSET_ROOT,
  "cyclonedx",
  "spdx.schema.json",
);
const CYCLONEDX_JSF_SCHEMA_PATH = join(
  SCHEMA_ASSET_ROOT,
  "cyclonedx",
  "jsf-0.82.schema.json",
);

const schemaBytes = (format: VexExportFormat): Buffer =>
  readFileSync(
    format === "openvex" ? OPENVEX_SCHEMA_PATH : CYCLONEDX_SCHEMA_PATH,
  );

const schemaSha256 = (format: VexExportFormat): string =>
  createHash("sha256").update(schemaBytes(format)).digest("hex");

let openVexValidator: ValidateFunction | undefined;
let cycloneDxValidator: ValidateFunction | undefined;

/**
 * Validates the exact serializable document before it is stored. Diagnostics
 * deliberately exclude data values so an unsafe payload can never leak via an
 * API error or worker log.
 */
export function validateVexExport(
  format: VexExportFormat,
  document: unknown,
): VexValidationResult {
  const validator =
    format === "openvex"
      ? (openVexValidator ??= createOpenVexValidator())
      : (cycloneDxValidator ??= createCycloneDxValidator());
  const valid = validator(document);
  const result: VexValidationResult = Object.freeze({
    valid,
    schemaSha256: schemaSha256(format),
    diagnostics: Object.freeze(
      valid ? [] : boundedDiagnostics(validator.errors ?? []),
    ),
  });
  if (!valid) throw new VexExportValidationError(format);
  return result;
}

function createOpenVexValidator(): ValidateFunction {
  const ajv = new Ajv2020({
    allErrors: false,
    strict: false,
    formats: { iri: true },
  });
  addFormats(ajv);
  return ajv.compile(readJson(OPENVEX_SCHEMA_PATH) as AnySchema);
}

function createCycloneDxValidator(): ValidateFunction {
  const ajv = new Ajv({
    allErrors: false,
    strict: false,
    formats: { "idn-email": true, "iri-reference": true, iri: true },
  });
  addFormats(ajv);
  ajv.addSchema(readJson(CYCLONEDX_SPDX_SCHEMA_PATH) as AnySchema);
  ajv.addSchema(readJson(CYCLONEDX_JSF_SCHEMA_PATH) as AnySchema);
  return ajv.compile(readJson(CYCLONEDX_SCHEMA_PATH) as AnySchema);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function boundedDiagnostics(
  errors: readonly ErrorObject[],
): readonly Readonly<{ path: string; message: string }>[] {
  return Object.freeze(
    errors.slice(0, 3).map((error) =>
      Object.freeze({
        path: error.instancePath || "$",
        message: error.keyword,
      }),
    ),
  );
}
