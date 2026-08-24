import { Readable } from "node:stream";

import { PackageURL } from "packageurl-js";
import { SaxesParser } from "saxes";
import { parser } from "stream-json";

export const NORMALIZER_VERSION = "m3-03.1";

type JsonToken = Readonly<{ name: string; value?: unknown }>;

export type SbomNormalizationFormat =
  | "cyclonedx-json"
  | "cyclonedx-xml"
  | "spdx-json"
  | "spdx-json-ld"
  | "spdx-tag-value";

export type SbomSourceLocation = Readonly<{
  offset: number;
  path: string;
  line: number | null;
}>;

export type NormalizedComponent = Readonly<{
  localRef: string | null;
  rawName: string | null;
  normalizedName: string | null;
  rawVersion: string | null;
  normalizedVersion: string | null;
  rawPurl: string | null;
  canonicalPurl: string | null;
  rawCpe: string | null;
  ecosystem: string | null;
  scope: string | null;
  supplier: string | null;
  licenseExpression: string | null;
  hashes: readonly Readonly<{ algorithm: string; value: string }>[];
  source: SbomSourceLocation;
}>;

export type NormalizedDependency = Readonly<{
  fromRef: string;
  toRef: string;
  source: SbomSourceLocation;
}>;

export type NormalizationDiagnostic = Readonly<{
  severity: "warning" | "error";
  code: string;
  message: string;
  source: SbomSourceLocation;
}>;

export type SbomNormalizationResult = Readonly<{
  format: SbomNormalizationFormat;
  specVersion: string | null;
  components: readonly NormalizedComponent[];
  edges: readonly NormalizedDependency[];
  diagnostics: readonly NormalizationDiagnostic[];
  byteSize: number;
}>;

export type SbomNormalizationOptions = Readonly<{
  maximumBytes: number;
  maximumComponents: number;
  /** Awaited before more source tokens are consumed; use this for durable writes. */
  onBatch?: (batch: SbomNormalizationBatch) => Promise<void>;
  maximumBatchRows?: number;
  maximumBatchBytes?: number;
  /** Defaults to true for unit callers; workers set false after durable batching. */
  retainResult?: boolean;
  maximumDiagnostics?: number;
}>;

export type SbomNormalizationBatch = Readonly<{
  components: readonly NormalizedComponent[];
  edges: readonly NormalizedDependency[];
}>;

export class SbomNormalizationError extends Error {
  constructor(
    readonly code:
      | "normalization_byte_limit_exceeded"
      | "normalization_component_limit_exceeded"
      | "normalization_malformed_input"
      | "normalization_unsupported_format"
      | "duplicate_local_reference"
      | "conflicting_local_reference_identity",
    message: string,
  ) {
    super(message);
  }
}

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
interface JsonObject {
  readonly [key: string]: JsonValue;
}
type JsonArray = readonly JsonValue[];
type MutableJsonObject = Record<string, JsonValue>;
type JsonFrame = {
  kind: "object" | "array";
  value: MutableJsonObject | JsonValue[];
  path: readonly string[];
  key: string | null;
  build: boolean;
  capture: CaptureKind | null;
};
type CaptureKind =
  "component" | "dependency" | "package" | "relationship" | "graph";

const componentPaths = new Map<string, CaptureKind>([
  ["components.[]", "component"],
  ["metadata.component", "component"],
  ["dependencies.[]", "dependency"],
  ["packages.[]", "package"],
  ["relationships.[]", "relationship"],
  ["@graph.[]", "graph"],
]);

const purlTypeEcosystem: Readonly<Record<string, string>> = Object.freeze({
  npm: "npm",
  maven: "maven",
  pypi: "pypi",
  nuget: "nuget",
  gem: "rubygems",
  golang: "golang",
  cargo: "cargo",
  composer: "composer",
  deb: "deb",
  rpm: "rpm",
  apk: "apk",
  conan: "conan",
  swid: "swid",
});

export function normalizePurl(rawPurl: string | null | undefined): Readonly<{
  rawPurl: string | null;
  canonicalPurl: string | null;
  ecosystem: string | null;
}> {
  if (rawPurl === null || rawPurl === undefined || rawPurl.length === 0) {
    return Object.freeze({
      rawPurl: rawPurl ?? null,
      canonicalPurl: null,
      ecosystem: null,
    });
  }
  try {
    const parsed = PackageURL.fromString(rawPurl);
    if (!parsed.type || !parsed.name)
      throw new Error("purl requires type and name");
    return Object.freeze({
      rawPurl,
      canonicalPurl: parsed.toString(),
      ecosystem: purlTypeEcosystem[parsed.type] ?? parsed.type,
    });
  } catch {
    return Object.freeze({ rawPurl, canonicalPurl: null, ecosystem: null });
  }
}

/** Conservative by design: this does not attempt semantic version equivalence. */
export function normalizeVersion(
  rawVersion: string | null | undefined,
): string | null {
  return rawVersion === null || rawVersion === undefined
    ? null
    : rawVersion.trim();
}

export async function normalizeSbomStream(
  input: Readable | AsyncIterable<Uint8Array>,
  options: SbomNormalizationOptions,
): Promise<SbomNormalizationResult> {
  validateOptions(options);
  const counted = countBytes(input, options.maximumBytes);
  const prefix = await readPrefix(counted, 4096);
  const stream = Readable.from(prefix.replay);
  const detected = detectSerialization(prefix.text);
  if (detected === "json")
    return normalizeJson(stream, options, prefix.counter);
  if (detected === "xml") return normalizeXml(stream, options, prefix.counter);
  if (detected === "tag-value")
    return normalizeTagValue(stream, options, prefix.counter);
  throw new SbomNormalizationError(
    "normalization_unsupported_format",
    "Unsupported SBOM serialization.",
  );
}

function validateOptions(options: SbomNormalizationOptions): void {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1) {
    throw new Error("normalizer maximumBytes must be a positive integer");
  }
  if (
    !Number.isSafeInteger(options.maximumComponents) ||
    options.maximumComponents < 1
  ) {
    throw new Error("normalizer maximumComponents must be a positive integer");
  }
  if (
    options.maximumBatchRows !== undefined &&
    (!Number.isSafeInteger(options.maximumBatchRows) ||
      options.maximumBatchRows < 1 ||
      options.maximumBatchRows > 1_000)
  ) {
    throw new Error("normalizer maximumBatchRows must be between 1 and 1000");
  }
  if (
    options.maximumBatchBytes !== undefined &&
    (!Number.isSafeInteger(options.maximumBatchBytes) ||
      options.maximumBatchBytes < 1 ||
      options.maximumBatchBytes > 8 * 1024 * 1024)
  ) {
    throw new Error("normalizer maximumBatchBytes must be between 1 and 8MiB");
  }
  if (
    options.maximumDiagnostics !== undefined &&
    (!Number.isSafeInteger(options.maximumDiagnostics) ||
      options.maximumDiagnostics < 1 ||
      options.maximumDiagnostics > 1_000)
  ) {
    throw new Error("normalizer maximumDiagnostics must be between 1 and 1000");
  }
}

class BatchEmitter {
  private components: NormalizedComponent[] = [];
  private edges: NormalizedDependency[] = [];
  private bytes = 0;
  private readonly maximumRows: number;
  private readonly maximumBytes: number;

  constructor(private readonly options: SbomNormalizationOptions) {
    this.maximumRows = options.maximumBatchRows ?? 250;
    this.maximumBytes = options.maximumBatchBytes ?? 512 * 1024;
  }

  async component(component: NormalizedComponent): Promise<void> {
    if (!this.options.onBatch) return;
    this.components.push(component);
    this.bytes += estimateRowBytes(component);
    await this.flushIfFull();
  }

  async edge(edge: NormalizedDependency): Promise<void> {
    if (!this.options.onBatch) return;
    this.edges.push(edge);
    this.bytes += estimateRowBytes(edge);
    await this.flushIfFull();
  }

  async finish(): Promise<void> {
    await this.flush();
  }

  private async flushIfFull(): Promise<void> {
    if (
      this.components.length + this.edges.length >= this.maximumRows ||
      this.bytes >= this.maximumBytes
    )
      await this.flush();
  }

  private async flush(): Promise<void> {
    if (
      !this.options.onBatch ||
      this.components.length + this.edges.length === 0
    )
      return;
    const batch = Object.freeze({
      components: Object.freeze(this.components),
      edges: Object.freeze(this.edges),
    });
    this.components = [];
    this.edges = [];
    this.bytes = 0;
    await this.options.onBatch(batch);
  }
}

function estimateRowBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

type CountedSource = Readonly<{
  iterable: AsyncIterable<Uint8Array>;
  counter: { bytes: number };
}>;

function countBytes(
  input: Readable | AsyncIterable<Uint8Array>,
  maximumBytes: number,
): CountedSource {
  const counter = { bytes: 0 };
  const source = input as AsyncIterable<Uint8Array>;
  return Object.freeze({
    counter,
    iterable: (async function* () {
      for await (const part of source) {
        const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
        counter.bytes += bytes.byteLength;
        if (counter.bytes > maximumBytes) {
          throw new SbomNormalizationError(
            "normalization_byte_limit_exceeded",
            "SBOM byte size exceeds the normalization limit.",
          );
        }
        yield bytes;
      }
    })(),
  });
}

async function readPrefix(
  source: CountedSource,
  maximumPrefixBytes: number,
): Promise<{
  text: string;
  replay: AsyncIterable<Uint8Array>;
  counter: { bytes: number };
}> {
  const iterator = source.iterable[Symbol.asyncIterator]();
  const prefix: Uint8Array[] = [];
  let length = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  while (length < maximumPrefixBytes) {
    const next = await iterator.next();
    if (next.done) break;
    prefix.push(next.value);
    const available = maximumPrefixBytes - length;
    const inspected = next.value.subarray(0, available);
    text += decoder.decode(inspected, { stream: true });
    length += inspected.byteLength;
  }
  return {
    text: text + decoder.decode(),
    counter: source.counter,
    replay: (async function* () {
      yield* prefix;
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    })(),
  };
}

function detectSerialization(
  prefix: string,
): "json" | "xml" | "tag-value" | null {
  const trimmed = prefix.replace(/^\uFEFF/u, "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<")) return "xml";
  if (/^SPDXVersion:/mu.test(trimmed)) return "tag-value";
  return null;
}

async function normalizeJson(
  input: Readable,
  options: SbomNormalizationOptions,
  counter: { bytes: number },
): Promise<SbomNormalizationResult> {
  const components: NormalizedComponent[] = [];
  const edges: NormalizedDependency[] = [];
  const diagnostics: NormalizationDiagnostic[] = [];
  const batches = new BatchEmitter(options);
  const localReferences = new Map<string, NormalizedComponent>();
  let componentCount = 0;
  const metadata: Record<string, string> = {};
  let sequence = 0;
  const tokenParser = parser({
    packKeys: true,
    packStrings: true,
    packNumbers: true,
  });
  const frames: JsonFrame[] = [];
  const consume = async (token: JsonToken): Promise<void> => {
    sequence += 1;
    switch (token.name) {
      case "startObject":
        startJsonFrame("object");
        return;
      case "startArray":
        startJsonFrame("array");
        return;
      case "endObject":
      case "endArray":
        await endJsonFrame();
        return;
      case "keyValue": {
        const current = frames.at(-1);
        if (current?.kind === "object" && typeof token.value === "string")
          current.key = token.value;
        return;
      }
      case "stringValue":
      case "numberValue":
      case "trueValue":
      case "falseValue":
      case "nullValue":
        addJsonValue(
          token.value ??
            (token.name === "nullValue" ? null : token.name === "trueValue"),
        );
        return;
      default:
        return;
    }
  };
  const startJsonFrame = (kind: JsonFrame["kind"]): void => {
    const parent = frames.at(-1);
    const path = nextJsonPath(parent);
    const capture = captureKindForPath(path);
    const build = Boolean(parent?.build || capture);
    const frame: JsonFrame = {
      kind,
      value: kind === "object" ? {} : [],
      path,
      key: null,
      build,
      capture,
    };
    frames.push(frame);
  };
  const endJsonFrame = async (): Promise<void> => {
    const frame = frames.pop();
    if (!frame) throw malformed("Unexpected JSON structure terminator.");
    if (frame.capture !== null) {
      await consumeCapturedJson(
        frame.capture,
        asJsonObject(frame.value),
        source(sequence, `$.${frame.path.join(".").replaceAll(".[]", "")}`),
      );
    }
    const parent = frames.at(-1);
    if (parent?.build) attachJsonValue(parent, frame.value);
  };
  const addJsonValue = (value: unknown): void => {
    const parent = frames.at(-1);
    if (!parent) return;
    const scalar = toJsonScalar(value);
    if (parent.build) attachJsonValue(parent, scalar);
    if (
      frames.length === 1 &&
      parent.kind === "object" &&
      parent.key !== null &&
      typeof scalar === "string"
    ) {
      metadata[parent.key] = scalar;
    }
  };
  try {
    input.pipe(tokenParser);
    for await (const token of tokenParser as AsyncIterable<JsonToken>)
      await consume(token);
  } catch (error) {
    if (error instanceof SbomNormalizationError) throw error;
    throw malformed("Malformed JSON SBOM.");
  }
  if (frames.length !== 0) throw malformed("Unclosed JSON structure.");
  await batches.finish();
  if (componentCount > options.maximumComponents) {
    throw new SbomNormalizationError(
      "normalization_component_limit_exceeded",
      "SBOM component count exceeds the normalization limit.",
    );
  }
  const format =
    metadata.bomFormat === "CycloneDX"
      ? "cyclonedx-json"
      : metadata["@context"] !== undefined
        ? "spdx-json-ld"
        : "spdx-json";
  return freezeResult(
    format,
    metadata.specVersion ?? metadata.spdxVersion ?? null,
    components,
    edges,
    diagnostics,
    counter.bytes,
  );

  async function consumeCapturedJson(
    kind: CaptureKind,
    value: JsonObject,
    location: SbomSourceLocation,
  ): Promise<void> {
    if (kind === "component")
      await addComponent(componentFromCycloneDx(value, location), "cyclonedx");
    else if (kind === "package")
      await addComponent(componentFromSpdx2(value, location), "spdx2");
    else if (kind === "graph") {
      const component = componentFromSpdx3(value, location);
      if (component !== null) await addComponent(component, "spdx3");
      await addEdges(edgesFromSpdx3(value, location));
    } else if (kind === "dependency")
      await addEdges(edgesFromCycloneDx(value, location));
    else await addEdges(edgesFromSpdxRelationship(value, location));
  }
  async function addComponent(
    component: NormalizedComponent,
    format: "cyclonedx" | "spdx2" | "spdx3",
  ): Promise<void> {
    assertUniqueLocalReference(localReferences, component);
    componentCount += 1;
    if (componentCount > options.maximumComponents) {
      throw new SbomNormalizationError(
        "normalization_component_limit_exceeded",
        "SBOM component count exceeds the normalization limit.",
      );
    }
    if (options.retainResult !== false) components.push(component);
    for (const diagnostic of componentDiagnostics(component, format)) {
      addDiagnostic(diagnostics, options, diagnostic);
    }
    if (component.rawPurl !== null && component.canonicalPurl === null) {
      addDiagnostic(
        diagnostics,
        options,
        warning(
          "invalid_purl",
          "The supplied PURL is invalid and was not canonicalized.",
          component.source,
        ),
      );
    }
    await batches.component(component);
  }
  async function addEdges(
    nextEdges: readonly NormalizedDependency[],
  ): Promise<void> {
    for (const edge of nextEdges) {
      if (options.retainResult !== false) edges.push(edge);
      await batches.edge(edge);
    }
  }
}

function captureKindForPath(path: readonly string[]): CaptureKind | null {
  const exact = componentPaths.get(path.join("."));
  if (exact !== undefined) return exact;
  return path.length >= 2 &&
    path.at(-1) === "[]" &&
    path.at(-2) === "components"
    ? "component"
    : null;
}

function nextJsonPath(parent: JsonFrame | undefined): readonly string[] {
  if (!parent) return [];
  if (parent.kind === "array") return [...parent.path, "[]"];
  if (parent.key === null)
    throw malformed("JSON object value without a property name.");
  return [...parent.path, parent.key];
}

function attachJsonValue(parent: JsonFrame, value: JsonValue): void {
  if (parent.kind === "array") (parent.value as JsonValue[]).push(value);
  else if (parent.key !== null) {
    (parent.value as MutableJsonObject)[parent.key] = value;
    parent.key = null;
  }
}

function toJsonScalar(value: unknown): string | number | boolean | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  return null;
}

function asJsonObject(value: MutableJsonObject | JsonValue[]): JsonObject {
  return Array.isArray(value) ? {} : value;
}

async function normalizeXml(
  input: Readable,
  options: SbomNormalizationOptions,
  counter: { bytes: number },
): Promise<SbomNormalizationResult> {
  const components: NormalizedComponent[] = [];
  const edges: NormalizedDependency[] = [];
  const diagnostics: NormalizationDiagnostic[] = [];
  const batches = new BatchEmitter(options);
  const localReferences = new Map<string, NormalizedComponent>();
  let publication = Promise.resolve();
  let componentCount = 0;
  const sax = new SaxesParser({ xmlns: false });
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const elements: Array<{
    name: string;
    attributes: Readonly<Record<string, string>>;
    text: string;
    offset: number;
  }> = [];
  const activeComponents: Array<{
    attributes: Readonly<Record<string, string>>;
    startDepth: number;
    values: Record<string, string>;
    hashes: Array<{ algorithm: string; value: string }>;
    source: SbomSourceLocation;
  }> = [];
  let activeDependency: { ref: string; source: SbomSourceLocation } | null =
    null;
  let specVersion: string | null = null;
  sax.on("opentag", (tag) => {
    const attributes = Object.fromEntries(
      Object.entries(tag.attributes).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
    const element = {
      name: tag.name,
      attributes,
      text: "",
      offset: sax.position,
    };
    elements.push(element);
    if (tag.name === "bom") {
      specVersion =
        attributes.xmlns?.match(/\/bom\/([0-9]+\.[0-9]+)/u)?.[1] ?? null;
    }
    if (tag.name === "component") {
      activeComponents.push({
        attributes,
        startDepth: elements.length,
        values: {},
        hashes: [],
        source: source(sax.position, xmlPath(elements), null),
      });
    }
    if (
      tag.name === "dependency" &&
      activeDependency === null &&
      attributes.ref
    ) {
      activeDependency = {
        ref: attributes.ref,
        source: source(sax.position, xmlPath(elements), null),
      };
    } else if (
      tag.name === "dependency" &&
      activeDependency !== null &&
      attributes.ref
    ) {
      const edge = Object.freeze({
        fromRef: activeDependency.ref,
        toRef: attributes.ref,
        source: source(sax.position, xmlPath(elements), null),
      });
      if (options.retainResult !== false) edges.push(edge);
      publication = publication.then(async () => batches.edge(edge));
    }
  });
  sax.on("text", (text) => {
    const current = elements.at(-1);
    if (current) current.text += text;
  });
  sax.on("closetag", () => {
    const element = elements.pop();
    if (!element) return;
    const parent = elements.at(-1);
    const activeComponent = activeComponents.at(-1);
    if (activeComponent !== undefined) {
      const path = xmlPath(
        [...elements, element].slice(activeComponent.startDepth),
      );
      if (element.name === "hash")
        activeComponent.hashes.push({
          algorithm: element.attributes.alg ?? "",
          value: element.text.trim(),
        });
      else if (element.text.trim().length > 0 && path.length > 0)
        activeComponent.values[path] = element.text.trim();
      if (element.name === "component") {
        const component = componentFromCycloneDxXml(activeComponent);
        assertUniqueLocalReference(localReferences, component);
        componentCount += 1;
        if (componentCount > options.maximumComponents)
          throw new SbomNormalizationError(
            "normalization_component_limit_exceeded",
            "SBOM component count exceeds the normalization limit.",
          );
        if (component.rawPurl !== null && component.canonicalPurl === null)
          addDiagnostic(
            diagnostics,
            options,
            warning(
              "invalid_purl",
              "The supplied PURL is invalid and was not canonicalized.",
              component.source,
            ),
          );
        for (const diagnostic of componentDiagnostics(component, "cyclonedx")) {
          addDiagnostic(diagnostics, options, diagnostic);
        }
        publication = publication.then(async () =>
          batches.component(component),
        );
        if (options.retainResult !== false) components.push(component);
        activeComponents.pop();
      }
    }
    if (
      element.name === "dependency" &&
      activeDependency !== null &&
      parent?.name === "dependencies"
    )
      activeDependency = null;
  });
  try {
    for await (const chunk of input as AsyncIterable<Uint8Array>)
      sax.write(decoder.decode(chunk, { stream: true }));
    sax.write(decoder.decode());
    sax.close();
  } catch (error) {
    if (error instanceof SbomNormalizationError) throw error;
    throw malformed("Malformed CycloneDX XML SBOM.");
  }
  await publication;
  await batches.finish();
  return freezeResult(
    "cyclonedx-xml",
    specVersion,
    components,
    edges,
    diagnostics,
    counter.bytes,
  );
}

async function normalizeTagValue(
  input: Readable,
  options: SbomNormalizationOptions,
  counter: { bytes: number },
): Promise<SbomNormalizationResult> {
  const components: NormalizedComponent[] = [];
  const diagnostics: NormalizationDiagnostic[] = [];
  const batches = new BatchEmitter(options);
  const localReferences = new Map<string, NormalizedComponent>();
  let componentCount = 0;
  let residual = "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let line = 0;
  let specVersion: string | null = null;
  let current: Record<string, string> | null = null;
  const complete = async (): Promise<void> => {
    if (current === null || Object.keys(current).length === 0) return;
    const component = componentFromSpdxTagValue(
      current,
      source(line, `line:${line}`, line),
    );
    assertUniqueLocalReference(localReferences, component);
    componentCount += 1;
    if (componentCount > options.maximumComponents)
      throw new SbomNormalizationError(
        "normalization_component_limit_exceeded",
        "SBOM component count exceeds the normalization limit.",
      );
    if (component.rawPurl !== null && component.canonicalPurl === null)
      addDiagnostic(
        diagnostics,
        options,
        warning(
          "invalid_purl",
          "The supplied PURL is invalid and was not canonicalized.",
          component.source,
        ),
      );
    for (const diagnostic of componentDiagnostics(component, "spdx2")) {
      addDiagnostic(diagnostics, options, diagnostic);
    }
    await batches.component(component);
    if (options.retainResult !== false) components.push(component);
    current = null;
  };
  const consumeLine = async (rawLine: string): Promise<void> => {
    line += 1;
    const separator = rawLine.indexOf(":");
    if (separator < 1) return;
    const tag = rawLine.slice(0, separator).trim();
    const value = rawLine.slice(separator + 1).trim();
    if (tag === "SPDXVersion") specVersion = value;
    if (tag === "PackageName") {
      await complete();
      current = { PackageName: value };
    } else if (current !== null) current[tag] = value;
  };
  for await (const chunk of input as AsyncIterable<Uint8Array>) {
    residual += decoder.decode(chunk, { stream: true });
    const lines = residual.split(/\r?\n/u);
    residual = lines.pop() ?? "";
    for (const value of lines) await consumeLine(value);
  }
  residual += decoder.decode();
  if (residual.length > 0) await consumeLine(residual);
  await complete();
  await batches.finish();
  return freezeResult(
    "spdx-tag-value",
    specVersion,
    components,
    [],
    diagnostics,
    counter.bytes,
  );
}

function componentFromCycloneDx(
  value: JsonObject,
  location: SbomSourceLocation,
): NormalizedComponent {
  return normalizedComponent({
    localRef: stringAt(value, "bom-ref"),
    rawName: stringAt(value, "name"),
    rawVersion: stringAt(value, "version"),
    rawPurl: stringAt(value, "purl"),
    rawCpe: stringAt(value, "cpe"),
    scope: stringAt(value, "scope"),
    supplier: nestedString(value, ["supplier", "name"]),
    licenseExpression: licenseFromCycloneDx(value),
    hashes: hashesFromJson(value),
    source: location,
  });
}

function componentFromSpdx2(
  value: JsonObject,
  location: SbomSourceLocation,
): NormalizedComponent {
  return normalizedComponent({
    localRef: stringAt(value, "SPDXID"),
    rawName: stringAt(value, "name"),
    rawVersion: stringAt(value, "versionInfo"),
    rawPurl: purlFromSpdx2(value),
    rawCpe: null,
    scope: null,
    supplier: stringAt(value, "supplier"),
    licenseExpression:
      stringAt(value, "licenseConcluded") ?? stringAt(value, "licenseDeclared"),
    hashes: hashesFromSpdx2(value),
    source: location,
  });
}

function componentFromSpdx3(
  value: JsonObject,
  location: SbomSourceLocation,
): NormalizedComponent | null {
  const type = stringAt(value, "type");
  if (type?.toLowerCase().includes("package") !== true) return null;
  return normalizedComponent({
    localRef: stringAt(value, "spdxId") ?? stringAt(value, "@id"),
    rawName: stringAt(value, "name"),
    rawVersion: stringAt(value, "software_packageVersion"),
    rawPurl: stringAt(value, "software_packageUrl"),
    rawCpe: null,
    scope: null,
    supplier: stringAt(value, "software_supplier"),
    licenseExpression: stringAt(value, "software_licenseConcluded"),
    hashes: [],
    source: location,
  });
}

function componentFromCycloneDxXml(active: {
  attributes: Readonly<Record<string, string>>;
  values: Record<string, string>;
  hashes: Array<{ algorithm: string; value: string }>;
  source: SbomSourceLocation;
}): NormalizedComponent {
  const values = active.values;
  return normalizedComponent({
    localRef: active.attributes["bom-ref"] ?? null,
    rawName: values.name ?? null,
    rawVersion: values.version ?? null,
    rawPurl: values.purl ?? null,
    rawCpe: values.cpe ?? null,
    scope: values.scope ?? null,
    supplier: values["supplier.name"] ?? null,
    licenseExpression: values["licenses.license.expression"] ?? null,
    hashes: active.hashes,
    source: active.source,
  });
}

function componentFromSpdxTagValue(
  value: Record<string, string>,
  location: SbomSourceLocation,
): NormalizedComponent {
  const externalRef = value.ExternalRef?.match(/\bpurl\s+(.+)$/iu)?.[1] ?? null;
  return normalizedComponent({
    localRef: value.SPDXID ?? null,
    rawName: value.PackageName ?? null,
    rawVersion: value.PackageVersion ?? value.PackageVersionInfo ?? null,
    rawPurl: externalRef,
    rawCpe: null,
    scope: null,
    supplier: value.PackageSupplier ?? null,
    licenseExpression:
      value.PackageLicenseConcluded ?? value.PackageLicenseDeclared ?? null,
    hashes: [],
    source: location,
  });
}

function normalizedComponent(
  input: Omit<
    NormalizedComponent,
    "normalizedName" | "normalizedVersion" | "canonicalPurl" | "ecosystem"
  >,
): NormalizedComponent {
  const purl = normalizePurl(input.rawPurl);
  const ecosystem = purl.ecosystem;
  return Object.freeze({
    ...input,
    rawName: input.rawName,
    normalizedName: normalizeName(input.rawName, ecosystem),
    rawVersion: input.rawVersion,
    normalizedVersion: normalizeVersion(input.rawVersion),
    rawPurl: purl.rawPurl,
    canonicalPurl: purl.canonicalPurl,
    ecosystem,
    hashes: Object.freeze(
      input.hashes.map((item) => Object.freeze({ ...item })),
    ),
  });
}

/** A reference is an unambiguous graph key, not a deduplication hint. */
function assertUniqueLocalReference(
  references: Map<string, NormalizedComponent>,
  component: NormalizedComponent,
): void {
  if (component.localRef === null) return;
  const existing = references.get(component.localRef);
  if (existing === undefined) {
    references.set(component.localRef, component);
    return;
  }
  const code =
    existing.canonicalPurl === component.canonicalPurl &&
    existing.normalizedName === component.normalizedName &&
    existing.normalizedVersion === component.normalizedVersion
      ? "duplicate_local_reference"
      : "conflicting_local_reference_identity";
  throw new SbomNormalizationError(
    code,
    `Document-local reference '${component.localRef}' is ambiguous.`,
  );
}

function normalizeName(
  rawName: string | null,
  ecosystem: string | null,
): string | null {
  if (rawName === null) return null;
  const trimmed = rawName.trim();
  return ecosystem === "npm" || ecosystem === "pypi" || ecosystem === "nuget"
    ? trimmed.toLowerCase()
    : trimmed;
}

function edgesFromCycloneDx(
  value: JsonObject,
  location: SbomSourceLocation,
): readonly NormalizedDependency[] {
  const fromRef = stringAt(value, "ref");
  const dependencies = arrayAt(value, "dependsOn");
  return fromRef === null
    ? []
    : dependencies
        .filter((item): item is string => typeof item === "string")
        .map((toRef, index) =>
          Object.freeze({
            fromRef,
            toRef,
            source: { ...location, offset: location.offset + index },
          }),
        );
}

function edgesFromSpdxRelationship(
  value: JsonObject,
  location: SbomSourceLocation,
): readonly NormalizedDependency[] {
  const relation = stringAt(value, "relationshipType")?.toUpperCase();
  const fromRef = stringAt(value, "spdxElementId");
  const toRef = stringAt(value, "relatedSpdxElement");
  return relation === "DEPENDS_ON" && fromRef !== null && toRef !== null
    ? [Object.freeze({ fromRef, toRef, source: location })]
    : [];
}

function edgesFromSpdx3(
  value: JsonObject,
  location: SbomSourceLocation,
): readonly NormalizedDependency[] {
  const relation =
    stringAt(value, "relationshipType")?.toUpperCase() ??
    stringAt(value, "software_relationshipType")?.toUpperCase();
  const fromRef = stringAt(value, "from") ?? stringAt(value, "spdxElementId");
  const toRef = stringAt(value, "to") ?? stringAt(value, "relatedSpdxElement");
  return relation === "DEPENDS_ON" && fromRef !== null && toRef !== null
    ? [Object.freeze({ fromRef, toRef, source: location })]
    : [];
}

function stringAt(value: JsonObject, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}
function arrayAt(value: JsonObject, key: string): readonly JsonValue[] {
  return Array.isArray(value[key]) ? (value[key] as JsonValue[]) : [];
}
function nestedString(
  value: JsonObject,
  keys: readonly string[],
): string | null {
  let current: JsonValue | undefined = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current))
      return null;
    current = (current as JsonObject)[key];
  }
  return typeof current === "string" ? current : null;
}
function hashesFromJson(
  value: JsonObject,
): readonly Readonly<{ algorithm: string; value: string }>[] {
  return arrayAt(value, "hashes").flatMap((hash) => {
    if (!hash || typeof hash !== "object" || Array.isArray(hash)) return [];
    const object = hash as JsonObject;
    const algorithm = stringAt(object, "alg");
    const digest = stringAt(object, "content");
    return algorithm !== null && digest !== null
      ? [{ algorithm, value: digest }]
      : [];
  });
}
function hashesFromSpdx2(
  value: JsonObject,
): readonly Readonly<{ algorithm: string; value: string }>[] {
  return arrayAt(value, "checksums").flatMap((hash) => {
    if (!hash || typeof hash !== "object" || Array.isArray(hash)) return [];
    const object = hash as JsonObject;
    const algorithm = stringAt(object, "algorithm");
    const digest = stringAt(object, "checksumValue");
    return algorithm !== null && digest !== null
      ? [{ algorithm, value: digest }]
      : [];
  });
}
function purlFromSpdx2(value: JsonObject): string | null {
  return (
    arrayAt(value, "externalRefs")
      .flatMap((ref) => {
        if (!ref || typeof ref !== "object" || Array.isArray(ref)) return [];
        const object = ref as JsonObject;
        return stringAt(object, "referenceType")?.toLowerCase().includes("purl")
          ? [stringAt(object, "referenceLocator")]
          : [];
      })
      .find((item): item is string => item !== null) ?? null
  );
}
function licenseFromCycloneDx(value: JsonObject): string | null {
  const licenses = arrayAt(value, "licenses");
  for (const entry of licenses) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const license = (entry as JsonObject).license;
    if (!license || typeof license !== "object" || Array.isArray(license))
      continue;
    return (
      stringAt(license as JsonObject, "expression") ??
      stringAt(license as JsonObject, "name")
    );
  }
  return null;
}
function xmlPath(elements: readonly { name: string }[]): string {
  return elements.map((element) => element.name).join(".");
}
function source(
  offset: number,
  path: string,
  line: number | null = null,
): SbomSourceLocation {
  return Object.freeze({ offset, path, line });
}
function warning(
  code: string,
  message: string,
  location: SbomSourceLocation,
): NormalizationDiagnostic {
  return Object.freeze({
    severity: "warning",
    code,
    message,
    source: location,
  });
}
function componentDiagnostics(
  component: NormalizedComponent,
  format: "cyclonedx" | "spdx2" | "spdx3",
): readonly NormalizationDiagnostic[] {
  const diagnostics: NormalizationDiagnostic[] = [];
  if (component.rawName === null || component.rawName.trim().length === 0) {
    diagnostics.push(
      Object.freeze({
        severity: "error",
        code:
          format === "spdx3"
            ? "missing_spdx3_package_name"
            : "missing_component_name",
        message: "A package or component name is required.",
        source: component.source,
      }),
    );
  }
  if (format !== "cyclonedx" && component.localRef === null) {
    diagnostics.push(
      Object.freeze({
        severity: "error",
        code: "missing_spdx_package_id",
        message: "An SPDX package identifier is required.",
        source: component.source,
      }),
    );
  }
  return Object.freeze(diagnostics);
}
function addDiagnostic(
  diagnostics: NormalizationDiagnostic[],
  options: SbomNormalizationOptions,
  value: NormalizationDiagnostic,
): void {
  if (diagnostics.length < (options.maximumDiagnostics ?? 100)) {
    diagnostics.push(value);
  }
}
function malformed(message: string): SbomNormalizationError {
  return new SbomNormalizationError("normalization_malformed_input", message);
}
function freezeResult(
  format: SbomNormalizationFormat,
  specVersion: string | null,
  components: readonly NormalizedComponent[],
  edges: readonly NormalizedDependency[],
  diagnostics: readonly NormalizationDiagnostic[],
  byteSize: number,
): SbomNormalizationResult {
  return Object.freeze({
    format,
    specVersion,
    components: Object.freeze([...components]),
    edges: Object.freeze([...edges]),
    diagnostics: Object.freeze([...diagnostics]),
    byteSize,
  });
}

type GraphInputComponent = Pick<NormalizedComponent, "localRef" | "source"> &
  Partial<Omit<NormalizedComponent, "localRef" | "source">>;
type ResolvedGraphComponent = GraphInputComponent &
  Readonly<{
    canonicalParentRef: string | null;
    depth: number;
  }>;

export function resolveSbomGraph(
  input: Readonly<{
    components: readonly GraphInputComponent[];
    edges: readonly NormalizedDependency[];
  }>,
): Readonly<{
  components: readonly ResolvedGraphComponent[];
  edges: readonly NormalizedDependency[];
  diagnostics: readonly NormalizationDiagnostic[];
}> {
  const byReference = new Map<string, GraphInputComponent>();
  for (const component of input.components) {
    if (component.localRef === null) continue;
    const normalized = component;
    const existing = byReference.get(component.localRef);
    if (existing) {
      const code = sameIdentity(existing, normalized)
        ? "duplicate_local_reference"
        : "conflicting_local_reference_identity";
      throw new SbomNormalizationError(
        code,
        `Document-local reference '${component.localRef}' is ambiguous.`,
      );
    }
    byReference.set(component.localRef, normalized);
  }
  const retained: NormalizedDependency[] = [];
  const diagnostics: NormalizationDiagnostic[] = [];
  const adjacency = new Map<string, string[]>();
  const edgeKeys = new Set<string>();
  for (const edge of [...input.edges].sort(compareEdges)) {
    const key = `${edge.fromRef}\u0000${edge.toRef}`;
    if (!byReference.has(edge.fromRef) || !byReference.has(edge.toRef)) {
      diagnostics.push(
        warning(
          "missing_dependency_reference",
          "A dependency references a missing component and was omitted.",
          edge.source,
        ),
      );
      continue;
    }
    if (edge.fromRef === edge.toRef) {
      diagnostics.push(
        warning(
          "self_dependency_edge",
          "A self dependency was omitted.",
          edge.source,
        ),
      );
      continue;
    }
    if (edgeKeys.has(key)) {
      diagnostics.push(
        warning(
          "duplicate_dependency_edge",
          "A duplicate dependency was omitted.",
          edge.source,
        ),
      );
      continue;
    }
    if (hasPath(adjacency, edge.toRef, edge.fromRef, byReference.size)) {
      diagnostics.push(
        warning(
          "cycle_dependency_edge",
          "A cycle-forming dependency was omitted.",
          edge.source,
        ),
      );
      continue;
    }
    edgeKeys.add(key);
    retained.push(edge);
    adjacency.set(edge.fromRef, [
      ...(adjacency.get(edge.fromRef) ?? []),
      edge.toRef,
    ]);
  }
  const incoming = new Map<string, NormalizedDependency[]>();
  for (const edge of retained)
    incoming.set(edge.toRef, [...(incoming.get(edge.toRef) ?? []), edge]);
  const roots = [...byReference.keys()]
    .filter((reference) => !incoming.has(reference))
    .sort((left, right) =>
      compareComponent(byReference.get(left)!, byReference.get(right)!),
    );
  const depth = new Map<string, number>(
    roots.map((reference) => [reference, 0]),
  );
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    const parent = queue[index]!;
    const nextDepth = (depth.get(parent) ?? 0) + 1;
    for (const child of [...(adjacency.get(parent) ?? [])].sort((left, right) =>
      compareComponent(byReference.get(left)!, byReference.get(right)!),
    )) {
      const previous = depth.get(child);
      if (previous === undefined || nextDepth < previous) {
        depth.set(child, nextDepth);
        queue.push(child);
      }
    }
  }
  return Object.freeze({
    components: Object.freeze(
      [...input.components].sort(compareComponent).map((component) =>
        Object.freeze({
          ...component,
          canonicalParentRef:
            (incoming.get(component.localRef ?? "") ?? []).sort(compareEdges)[0]
              ?.fromRef ?? null,
          depth: depth.get(component.localRef ?? "") ?? 0,
        }),
      ),
    ),
    edges: Object.freeze(retained),
    diagnostics: Object.freeze(diagnostics),
  });
}

function hasPath(
  adjacency: ReadonlyMap<string, readonly string[]>,
  start: string,
  target: string,
  maximumVisits: number,
): boolean {
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0 && visited.size <= maximumVisits) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}
function sameIdentity(
  left: GraphInputComponent,
  right: GraphInputComponent,
): boolean {
  return (
    left.canonicalPurl === right.canonicalPurl &&
    left.normalizedName === right.normalizedName &&
    left.normalizedVersion === right.normalizedVersion
  );
}
function compareEdges(
  left: NormalizedDependency,
  right: NormalizedDependency,
): number {
  return (
    left.source.offset - right.source.offset ||
    left.fromRef.localeCompare(right.fromRef) ||
    left.toRef.localeCompare(right.toRef)
  );
}
function compareComponent(
  left: GraphInputComponent,
  right: GraphInputComponent,
): number {
  return (
    left.source.offset - right.source.offset ||
    (left.localRef ?? "").localeCompare(right.localRef ?? "")
  );
}
