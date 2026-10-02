import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

/**
 * CSAF documents are validated against the locally vendored OASIS CSAF 2.0
 * Errata 01 schema. The schema references CVSS schemas by URL, so those exact
 * references are also supplied locally: validation never reaches the network.
 */
const assetRoot = join(__dirname, "../../sboms/validation/assets/csaf");
let validator: ValidateFunction | undefined;

export function isValidatedCsafDocument(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return csafValidator()(value);
}

export function resetCsafDocumentValidatorForTests(): void {
  validator = undefined;
}

function csafValidator(): ValidateFunction {
  if (validator !== undefined) return validator;

  const ajv = new Ajv({
    // CSAF documents can contain many repeated invalid assertions. One stable
    // decision is sufficient at this boundary and avoids unbounded diagnostics.
    allErrors: false,
    strict: false,
    // The official CVSS companions declare draft-04. Ajv v8 does not bundle
    // that historical meta-schema; they are locally trusted, so skip only
    // meta-schema validation while still compiling and applying their rules.
    validateSchema: false,
  });
  addFormats(ajv);
  addCvssSchema(
    ajv,
    "cvss-v2.0.json",
    "https://www.first.org/cvss/cvss-v2.0.json",
  );
  addCvssSchema(
    ajv,
    "cvss-v3.0.json",
    "https://www.first.org/cvss/cvss-v3.0.json",
  );
  addCvssSchema(
    ajv,
    "cvss-v3.1.json",
    "https://www.first.org/cvss/cvss-v3.1.json",
  );
  validator = ajv.compile(
    readJsonAsset("csaf-v2.0-errata01.schema.json") as AnySchema,
  );
  return validator;
}

function addCvssSchema(ajv: Ajv, fileName: string, canonicalId: string): void {
  const schema = readJsonAsset(fileName);
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("invalid locally vendored CSAF dependency schema");
  }
  // These published companions use the draft-04 `id` keyword only at their
  // root. Ajv v8 rejects that deprecated spelling, so replace it with the
  // canonical reference used by the CSAF schema before compilation.
  const withoutLegacyId = Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== "id"),
  );
  ajv.addSchema({ ...withoutLegacyId, $id: canonicalId });
}

function readJsonAsset(fileName: string): unknown {
  return JSON.parse(readFileSync(join(assetRoot, fileName), "utf8")) as unknown;
}
