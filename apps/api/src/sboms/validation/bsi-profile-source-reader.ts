import { Readable } from "node:stream";
import { SaxesParser } from "saxes";
import { boundedJsonTokens } from "./bounded-json-tokens";
type ObjectValue = Record<string, unknown>;
export interface BsiSourceFactSink {
  root(key: string, value: unknown): void;
  consume(
    path: readonly string[],
    value: unknown,
    offset: number,
    xml?: boolean,
    sourcePath?: string,
  ): void;
}
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
type Frame = {
  path: string[];
  sourcePath: string;
  nextIndex: number;
  value: ObjectValue | unknown[];
  key: string | null;
  capture: boolean;
  build: boolean;
};
const maximumScalarBytes = 1024 * 1024;
export async function readBsiJson(
  source: Readable,
  collector: BsiSourceFactSink,
): Promise<void> {
  const frames: Frame[] = [];
  let sequence = 0;
  const selected = new Set([
    "components",
    "packages",
    "files",
    "@graph",
    "dependencies",
    "relationships",
    "vulnerabilities",
    "externalReferences",
    "externalDocumentRefs",
  ]);
  function attach(parent: Frame, value: unknown): void {
    if (Array.isArray(parent.value)) parent.value.push(value);
    else if (parent.key !== null) {
      parent.value[parent.key] = value;
      parent.key = null;
    }
  }
  for await (const token of boundedJsonTokens(source)) {
    sequence += 1;
    if (token.name === "startObject" || token.name === "startArray") {
      const parent = frames.at(-1),
        path = parent
          ? [
              ...parent.path,
              Array.isArray(parent.value) ? "[]" : (parent.key ?? ""),
            ]
          : [];
      const sourcePath = parent
        ? Array.isArray(parent.value)
          ? `${parent.sourcePath}[${parent.nextIndex++}]`
          : /^[A-Za-z_$][\w$]*$/.test(parent.key ?? "")
            ? `${parent.sourcePath}.${parent.key}`
            : `${parent.sourcePath}[${JSON.stringify(parent.key)}]`
        : "$";
      const capture =
        (path.at(-1) === "[]" &&
          selected.has(path.at(-2) ?? "") &&
          (path.length === 2 || path.at(-2) === "components")) ||
        path.join(".") === "metadata.component";
      const rootObject =
        path.length === 1 && ["metadata", "creationInfo"].includes(path[0]!);
      frames.push({
        path,
        sourcePath,
        nextIndex: 0,
        value:
          token.name === "startArray"
            ? []
            : (Object.create(null) as ObjectValue),
        key: null,
        capture,
        build:
          capture ||
          rootObject ||
          Boolean(parent?.build && !(path.at(-1) === "components")),
      });
    } else if (token.name === "keyValue") {
      const current = frames.at(-1);
      if (current) current.key = String(token.value);
    } else if (token.name === "endObject" || token.name === "endArray") {
      const frame = frames.pop();
      if (!frame) throw new Error("Invalid BSI JSON structure.");
      if (frame.capture)
        collector.consume(
          frame.path,
          frame.value,
          sequence,
          false,
          frame.sourcePath,
        );
      else if (
        frame.path.length === 1 &&
        ["metadata", "creationInfo"].includes(frame.path[0]!)
      )
        collector.root(frame.path[0]!, frame.value);
      const parent = frames.at(-1);
      if (parent?.build && !frame.capture) attach(parent, frame.value);
    } else if (
      [
        "stringValue",
        "numberValue",
        "nullValue",
        "trueValue",
        "falseValue",
      ].includes(token.name)
    ) {
      const value =
        token.name === "nullValue"
          ? null
          : token.name === "trueValue"
            ? true
            : token.name === "falseValue"
              ? false
              : token.value;
      const parent = frames.at(-1);
      if (parent && Array.isArray(parent.value)) parent.nextIndex += 1;
      if (parent?.build) attach(parent, value);
      else if (parent?.path.length === 0 && parent.key)
        collector.root(parent.key, value);
    }
  }
  if (frames.length !== 0) throw new Error("Incomplete BSI JSON source.");
}

type XmlNode = {
  name: string;
  attributes: ObjectValue;
  children: XmlNode[];
  text: string;
  path: string[];
  offset: number;
  sourcePath: string;
  childCounts: Map<string, number>;
  capture: boolean;
  build: boolean;
  budget: { bytes: number };
};
export async function readBsiXml(
  source: Readable,
  collector: BsiSourceFactSink,
): Promise<void> {
  const sax = new SaxesParser({ xmlns: true }),
    frames: XmlNode[] = [];
  let tokenBytes = 0,
    inTag = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  sax.on("error", (error) => {
    throw error;
  });
  sax.on("doctype", () => {
    throw new Error("BSI XML DTD declarations are forbidden.");
  });
  sax.on("opentag", (tag) => {
    const name = tag.local,
      path = [...frames.map((frame) => frame.name), name],
      parent = frames.at(-1);
    if (frames.length >= 256 || Object.keys(tag.attributes).length > 128)
      throw new Error("BSI XML structure ceiling exceeded.");
    const occurrence = (parent?.childCounts.get(name) ?? 0) + 1;
    parent?.childCounts.set(name, occurrence);
    const sourcePath = `${parent?.sourcePath ?? ""}/${name}[${occurrence}]`;
    const capture =
      name === "component" ||
      (name === "dependency" && parent?.name === "dependencies") ||
      name === "vulnerability";
    const metadata = name === "metadata" && parent?.name === "bom";
    const attributes = Object.fromEntries(
      Object.entries(tag.attributes).map(([key, value]) => [
        key,
        typeof value === "string" ? value : value.value,
      ]),
    );
    if (name === "bom") collector.root("serialNumber", attributes.serialNumber);
    const build = capture || metadata || Boolean(parent?.build);
    const budget =
      capture || metadata ? { bytes: 0 } : (parent?.budget ?? { bytes: 0 });
    if (build) {
      budget.bytes +=
        32 +
        Buffer.byteLength(name) +
        Object.entries(attributes).reduce(
          (sum, [key, value]) =>
            sum +
            Buffer.byteLength(key) +
            Buffer.byteLength(String(value)) +
            16,
          0,
        );
      if (budget.bytes > maximumScalarBytes)
        throw new Error("BSI XML subtree ceiling exceeded.");
    }
    frames.push({
      name,
      attributes,
      children: [],
      text: "",
      path,
      offset: sax.position,
      sourcePath,
      childCounts: new Map(),
      capture,
      build,
      budget,
    });
  });
  const append = (value: string): void => {
    const frame = frames.at(-1);
    if (frame?.build) {
      frame.budget.bytes += Buffer.byteLength(value);
      if (frame.budget.bytes > maximumScalarBytes)
        throw new Error("BSI XML subtree ceiling exceeded.");
      frame.text += value;
    }
  };
  sax.on("text", append);
  sax.on("cdata", append);
  sax.on("closetag", () => {
    const frame = frames.pop();
    if (!frame) throw new Error("Invalid BSI XML structure.");
    const parent = frames.at(-1);
    if (frame.capture) {
      collector.consume(
        frame.path,
        xmlObject(frame),
        frame.offset,
        true,
        frame.sourcePath,
      );
    } else if (frame.name === "metadata" && parent?.name === "bom") {
      collector.root("metadata", xmlObject(frame));
    }
    if (parent?.build && !frame.capture) parent.children.push(frame);
  });
  for await (const raw of source as AsyncIterable<Uint8Array>) {
    const decoded = decoder.decode(raw, { stream: true });
    // Lexical guard precedes SAX so unfinished attributes/DTD cannot grow unbounded.
    for (const character of decoded) {
      if (character === "<") {
        inTag = true;
        tokenBytes = 0;
      }
      tokenBytes += Buffer.byteLength(character);
      if (tokenBytes > (inTag ? 64 * 1024 : maximumScalarBytes))
        throw new Error("BSI XML token ceiling exceeded.");
      if (character === ">" && inTag) {
        inTag = false;
        tokenBytes = 0;
      }
    }
    sax.write(decoded);
  }
  sax.write(decoder.decode()).close();
}
function xmlObject(node: XmlNode): ObjectValue {
  const result: ObjectValue = { ...node.attributes };
  for (const child of node.children) {
    const value =
      child.children.length === 0 && Object.keys(child.attributes).length === 0
        ? child.text.trim()
        : xmlObject(child);
    const previous: unknown = result[child.name];
    if (previous === undefined) result[child.name] = value;
    else if (Array.isArray(previous)) (previous as unknown[]).push(value);
    else result[child.name] = [previous, value];
  }
  if (node.name === "hash") result.content = node.text.trim();
  if (node.name === "property") result.value = node.text.trim();
  if (node.name === "expression") result.expression = node.text.trim();
  for (const [wrapper, item] of [
    ["authors", "author"],
    ["hashes", "hash"],
    ["properties", "property"],
    ["licenses", "license"],
    ["externalReferences", "reference"],
  ] as const) {
    if (result[wrapper] !== undefined) {
      const wrapped = object(result[wrapper]);
      result[wrapper] =
        wrapper === "licenses" && wrapped.expression !== undefined
          ? array(wrapped.expression).map((entry) =>
              typeof entry === "string" ? { expression: entry } : entry,
            )
          : array(wrapped[item]).map((entry) =>
              wrapper === "licenses" ? { license: entry } : entry,
            );
    }
  }
  if (node.name === "dependency")
    result.dependsOn = node.children
      .filter((child) => child.name === "dependency")
      .flatMap((child) =>
        text(child.attributes.ref) ? [text(child.attributes.ref)!] : [],
      );
  return result;
}
