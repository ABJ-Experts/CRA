import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { SbomValidationDiagnostic } from "@repo/contracts/sboms";
import type { ValidateFunction } from "ajv";
import { boundedJsonTokens } from "./bounded-json-tokens";

import { SbomNormalizationError } from "../normalization/sbom-normalization-error";
import type { SbomNormalizationResult } from "../normalization/sbom-normalizer";
import {
  SCHEMA_ASSET_MANIFEST,
  SCHEMA_ASSET_ROOT,
  schemaAssetSha256ForDetection,
} from "./schema-manifest";
import {
  BoundedDiagnosticCollector,
  diagnostic,
  VALIDATION_POLICY,
} from "./sbom-validation-policy";
import {
  missingSpdx3ProfileDiagnostics,
  schemaValidator,
  streamingJsonSchemaValidators,
  spdx3Profile,
  spdx3ReferenceDiagnostics,
  validateSpdx3Terms,
  SbomValidationInfrastructureError,
  validateSbom,
} from "./sbom-validator";

type Detected = Pick<SbomNormalizationResult, "format" | "specVersion">;
export const STREAMING_VALIDATOR_VERSION = "m3-03.2026-09-28.1";

export type StreamingValidationResult = Readonly<{
  diagnostics: readonly SbomValidationDiagnostic[];
  errorCount: number;
  warningCount: number;
  omittedDiagnosticCount: number;
  schemaAssetSha256: string | null;
}>;
type Frame = {
  value: unknown[] | Record<string, unknown>;
  key: string | null;
  path: string[];
  array: boolean;
};

/** Validate pinned schemas record by record. Only a bounded subtree is built,
 * never the source document or an array of its component payloads. */
export function canonicalSbomSpecificationVersion(
  version: string | null,
): string | null {
  return (
    version?.replace(/^SPDX-/u, "").replace(/^3\.0\.[01]$/u, "3.0") ?? null
  );
}

export async function validateSbomFile(
  path: string,
  detected: Detected,
  onProgress?: () => Promise<void>,
): Promise<StreamingValidationResult> {
  const collector = new BoundedDiagnosticCollector(
    VALIDATION_POLICY.maximumDiagnostics,
  );
  const version = canonicalSbomSpecificationVersion(detected.specVersion);
  const cyclonedx = detected.format.startsWith("cyclonedx");
  const format = cyclonedx ? "cyclonedx" : "spdx";
  const serialization = detected.format.endsWith("xml")
    ? "xml"
    : detected.format === "spdx-tag-value"
      ? "tag_value"
      : "json";
  const supported = cyclonedx
    ? ["1.4", "1.5", "1.6"].includes(version ?? "")
    : ["2.2", "2.3", "3.0"].includes(version ?? "");
  if (!supported || (serialization === "tag_value" && version === "3.0")) {
    collector.push(
      problem(
        "unsupported_spec_version",
        "$",
        "The detected SBOM edition or serialization is not supported.",
      ),
    );
  } else if (serialization === "xml") {
    if (!(await validateXml(path, version!)))
      collector.push(
        problem(
          "schema_violation",
          "$",
          "CycloneDX XML does not conform to the pinned XSD.",
        ),
      );
  } else if (serialization === "tag_value") {
    await validateTagValue(path, collector);
  } else {
    await validateJson(path, `${format}-${version}`, collector, onProgress);
  }
  return Object.freeze({
    diagnostics: collector.toArray(),
    errorCount: collector.counts.error,
    warningCount: collector.counts.warning,
    omittedDiagnosticCount: collector.omittedCount,
    schemaAssetSha256: streamingSchemaHash(format, serialization, version),
  });
}

function streamingSchemaHash(
  format: "cyclonedx" | "spdx",
  serialization: "json" | "xml" | "tag_value",
  version: string | null,
): string {
  const primary = schemaAssetSha256ForDetection({
    format,
    serialization,
    version,
  });
  return serialization === "xml"
    ? createHash("sha256")
        .update(
          `${primary}:${SCHEMA_ASSET_MANIFEST.find((asset) => asset.id === "cyclonedx-spdx-license-xml")!.sha256}`,
        )
        .digest("hex")
    : primary;
}

function problem(
  code: string,
  location: string,
  message: string,
): SbomValidationDiagnostic {
  return diagnostic(
    "error",
    code,
    location,
    message,
    "Correct the original SBOM and upload a new immutable version.",
  );
}

async function validateXml(path: string, version: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "xmllint",
      [
        "--stream",
        "--nonet",
        "--noout",
        "--schema",
        join(SCHEMA_ASSET_ROOT, `cyclonedx/bom-${version}.xsd`),
        path,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          XML_CATALOG_FILES: join(SCHEMA_ASSET_ROOT, "cyclonedx/catalog.xml"),
        },
      },
    );
    // Drain without collecting potentially sensitive source-derived error text.
    child.stderr.resume();
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new SbomValidationInfrastructureError(
          "validator_unavailable",
          "Streaming XML validator timed out.",
        ),
      );
    }, VALIDATION_POLICY.workerTimeoutMs);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(
        new SbomValidationInfrastructureError(
          "validator_unavailable",
          "Streaming XML validator is unavailable.",
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === null || code === 5 || code === 9) {
        reject(
          new SbomValidationInfrastructureError(
            "validator_unavailable",
            "Streaming XML validator could not complete.",
          ),
        );
        return;
      }
      resolve(code === 0);
    });
  });
}

function schemaError(
  validator: ValidateFunction,
  value: unknown,
  location: string,
  collector: BoundedDiagnosticCollector,
): void {
  if (!validator(value))
    collector.push(
      problem(
        "schema_violation",
        location,
        "The SBOM value does not conform to the pinned JSON schema.",
      ),
    );
}

async function validateJson(
  path: string,
  id: string,
  collector: BoundedDiagnosticCollector,
  onProgress?: () => Promise<void>,
): Promise<void> {
  const root: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const counts = new Map<string, number>();
  const unique = new Map<string, Set<string>>();
  const profileNodes: Record<string, unknown>[] = [];
  const profileTypes = new Set<string>();
  let rootBytes = 0;
  const references: Record<string, unknown>[] = [];
  const spdx3 = id === "spdx-3.0";
  const validator = spdx3 ? null : schemaValidator(id);
  const validators = spdx3 ? null : streamingJsonSchemaValidators(id);
  const properties = validator
    ? (
        validator.schema as {
          properties: Record<string, Record<string, unknown>>;
        }
      ).properties
    : {};
  await walkJson(
    path,
    (key, value, item) => {
      if (!item) {
        rootBytes +=
          Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value));
        if (rootBytes > VALIDATION_POLICY.maximumScalarBytes)
          throw new SbomNormalizationError(
            "normalization_malformed_input",
            "JSON root metadata ceiling exceeded",
          );
        root[key] = value;
        return;
      }
      root[key] = [];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (spdx3) {
        if (
          key !== "@graph" ||
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value)
        ) {
          collector.push(
            problem(
              "invalid_spdx3_graph_item",
              `$.${key}`,
              "SPDX graph nodes must be objects.",
            ),
          );
          return;
        }
        const node = value as Record<string, unknown>;
        validateSpdx3Terms(node, "$.@graph", spdx3Profile().terms, collector);
        if (
          typeof node.type === "string" &&
          [
            "CreationInfo",
            "SpdxDocument",
            "software_Sbom",
            "software_Package",
          ].includes(node.type) &&
          !profileTypes.has(node.type)
        ) {
          profileTypes.add(node.type);
          profileNodes.push(node);
        }
        references.push(
          Object.fromEntries(
            [
              "type",
              "spdxId",
              "@id",
              "creationInfo",
              "rootElement",
              "createdBy",
            ]
              .filter((name) => Object.hasOwn(node, name))
              .map((name) => [name, node[name]]),
          ),
        );
        return;
      }
      const property = properties[key];
      if (!property || property.type !== "array") {
        collector.push(
          problem(
            "schema_violation",
            `$.${key}`,
            "Unsupported SBOM array property.",
          ),
        );
        return;
      }
      if (property.uniqueItems === true) {
        const digest = createHash("sha256")
          .update(
            JSON.stringify(value, (_key, item: unknown) =>
              typeof item === "object" && item !== null && !Array.isArray(item)
                ? Object.fromEntries(
                    Object.entries(item).sort(([left], [right]) =>
                      left < right ? -1 : left > right ? 1 : 0,
                    ),
                  )
                : item,
            ),
          )
          .digest("hex");
        const seen = unique.get(key) ?? new Set<string>();
        if (seen.has(digest))
          collector.push(
            problem(
              "schema_violation",
              `$.${key}`,
              "Duplicate array item violates the pinned schema.",
            ),
          );
        seen.add(digest);
        unique.set(key, seen);
      }
      // One-item envelope validates nested $refs using the original schema.
      // Root fields are supplied from a bounded first pass below.
    },
    onProgress,
  );
  if (spdx3) {
    if (root["@context"] !== spdx3Profile().officialContext)
      collector.push(
        problem(
          "invalid_spdx3_context",
          "$.@context",
          "Use the pinned SPDX JSON-LD context.",
        ),
      );
    for (const key of Object.keys(root))
      if (!["@context", "@graph"].includes(key))
        collector.push(
          problem(
            "unsupported_spdx3_term",
            `$.${key}`,
            "Unsupported SPDX root property.",
          ),
        );
    collector.push(...missingSpdx3ProfileDiagnostics(profileNodes));
    spdx3ReferenceDiagnostics(references, collector);
    return;
  }
  schemaError(validators!.root, root, "$", collector);
  for (const [key, count] of counts) {
    const property = properties[key];
    if (
      property &&
      ((typeof property.minItems === "number" && count < property.minItems) ||
        (typeof property.maxItems === "number" && count > property.maxItems))
    )
      collector.push(
        problem(
          "schema_violation",
          `$.${key}`,
          "Array size violates the pinned schema.",
        ),
      );
  }
  await walkJson(
    path,
    (key, value, item) => {
      if (item && validators!.items[key])
        schemaError(validators!.items[key], value, `$.${key}`, collector);
    },
    onProgress,
  );
}

/** Bounded JSON tree assembly: each root-array item is released immediately. */
async function walkJson(
  path: string,
  consume: (key: string, value: unknown, item: boolean) => Promise<void> | void,
  onProgress?: () => Promise<void>,
): Promise<void> {
  const input = createReadStream(path, { highWaterMark: 16 * 1024 });

  const frames: Frame[] = [];
  let subtreeBytes = 0;
  let totalTokens = 0;
  function attach(frame: Frame, value: unknown): void {
    if (frame.array) (frame.value as unknown[]).push(value);
    else if (frame.key !== null) {
      (frame.value as Record<string, unknown>)[frame.key] = value;
      frame.key = null;
    }
  }
  try {
    for await (const token of boundedJsonTokens(input, onProgress)) {
      totalTokens += 1;
      if (totalTokens > VALIDATION_POLICY.maximumTokens * 20)
        throw new Error("JSON token limit exceeded");
      if (token.name === "startObject" || token.name === "startArray") {
        const parent = frames.at(-1);
        const path = !parent
          ? []
          : [...parent.path, parent.array ? "[]" : (parent.key ?? "")];
        if (frames.length > VALIDATION_POLICY.maximumDepth)
          throw new Error("JSON depth limit exceeded");
        frames.push({
          path,
          array: token.name === "startArray",
          value:
            token.name === "startArray"
              ? []
              : (Object.create(null) as Record<string, unknown>),
          key: null,
        });
      } else if (token.name === "keyValue") {
        const frame = frames.at(-1);
        if (frame) frame.key = String(token.value);
      } else if (token.name === "endObject" || token.name === "endArray") {
        const frame = frames.pop();
        if (!frame) throw new Error("Invalid JSON structure");
        const parent = frames.at(-1);
        if (frame.path.length === 2 && frame.path[1] === "[]") {
          await consume(frame.path[0]!, frame.value, true);
          subtreeBytes = 0;
        } else if (frame.path.length === 1) {
          await consume(frame.path[0]!, frame.value, false);
          subtreeBytes = 0;
        } else if (parent) attach(parent, frame.value);
      } else if (
        [
          "stringValue",
          "numberValue",
          "trueValue",
          "falseValue",
          "nullValue",
        ].includes(token.name)
      ) {
        const value =
          token.name === "nullValue"
            ? null
            : token.name === "trueValue"
              ? true
              : token.name === "falseValue"
                ? false
                : token.name === "numberValue"
                  ? Number(token.value)
                  : token.value;
        subtreeBytes +=
          typeof value === "string" ? Buffer.byteLength(value) : 8;
        if (subtreeBytes > VALIDATION_POLICY.maximumScalarBytes)
          throw new Error("JSON subtree limit exceeded");
        const parent = frames.at(-1);
        if (parent && frames.length === 1) {
          await consume(parent.key!, value, false);
          parent.key = null;
          subtreeBytes = 0;
        } else if (parent && frames.length === 2 && parent.array) {
          await consume(parent.path[0]!, value, true);
          subtreeBytes = 0;
        } else if (parent) attach(parent, value);
      }
    }
  } finally {
    input.destroy();
  }
}

async function validateTagValue(
  path: string,
  collector: BoundedDiagnosticCollector,
): Promise<void> {
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let header = "";
  let section = "";
  let inText = false;
  async function check(): Promise<void> {
    if (!section) return;
    const result = await validateSbom({ bytes: Buffer.from(header + section) });
    collector.push(...result.diagnostics);
    section = "";
  }
  try {
    for await (const line of lines) {
      if (!inText && line.startsWith("PackageName:")) {
        await check();
        section = `${line}\n`;
      } else if (section) section += `${line}\n`;
      else header += `${line}\n`;
      if (line.includes("<text>") && !line.includes("</text>")) inText = true;
      if (line.includes("</text>")) inText = false;
      if (
        Buffer.byteLength(header) + Buffer.byteLength(section) >
        VALIDATION_POLICY.maximumScalarBytes
      ) {
        collector.push(
          problem(
            "scalar_limit_exceeded",
            "$",
            "SPDX section exceeds the configured bound.",
          ),
        );
        return;
      }
    }
    if (section) await check();
    else
      collector.push(
        ...(await validateSbom({ bytes: Buffer.from(header) })).diagnostics,
      );
  } finally {
    lines.close();
    input.destroy();
  }
}
