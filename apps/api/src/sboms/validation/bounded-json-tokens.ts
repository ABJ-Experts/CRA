import { Readable } from "node:stream";
import { parser } from "stream-json";
import {
  SbomNormalizationError,
  SbomStreamSourceError,
} from "../normalization/sbom-normalization-error";
import { VALIDATION_POLICY } from "./sbom-validation-policy";

export type BoundedJsonToken = Readonly<{ name: string; value?: unknown }>;

/** String/key/number fragments are checked before they can form a large value. */
export async function* boundedJsonTokens(
  input: Readable,
  onProgress?: () => Promise<void>,
): AsyncGenerator<BoundedJsonToken> {
  const tokens = parser({
    packKeys: false,
    packStrings: false,
    packNumbers: false,
    streamKeys: true,
    streamStrings: true,
    streamNumbers: true,
  });
  const forwardError = (error: Error) =>
    tokens.destroy(
      error instanceof SbomNormalizationError ||
        error instanceof SbomStreamSourceError
        ? error
        : new SbomStreamSourceError(error),
    );
  input.on("error", forwardError);
  input.pipe(tokens);
  let text = "";
  let bytes = 0;
  let kind: "key" | "string" | "number" | null = null;
  let depth = 0;
  let count = 0;
  let subtreeBytes = 0;
  const containers: string[] = [];
  const propertyNames: Array<Set<string> | null> = [];
  let rootKeyBytes = 0;
  try {
    for await (const token of tokens as AsyncIterable<BoundedJsonToken>) {
      count += 1;
      if (count % 1000 === 0 && onProgress) await onProgress();
      if (count > VALIDATION_POLICY.maximumTokens * 20)
        throw new SbomNormalizationError(
          "normalization_malformed_input",
          "JSON token ceiling exceeded.",
        );
      if (["startObject", "startArray"].includes(token.name)) {
        depth += 1;
        containers.push(token.name);
        propertyNames.push(
          token.name === "startObject" ? new Set<string>() : null,
        );
        subtreeBytes += 16;
        if (subtreeBytes > VALIDATION_POLICY.maximumScalarBytes)
          throw new SbomNormalizationError(
            "normalization_malformed_input",
            "JSON subtree ceiling exceeded.",
          );
        if (depth > VALIDATION_POLICY.maximumDepth)
          throw new SbomNormalizationError(
            "normalization_malformed_input",
            "JSON depth ceiling exceeded.",
          );
      } else if (["endObject", "endArray"].includes(token.name)) {
        const release =
          depth === 2 || (depth === 3 && containers[1] === "startArray");
        depth -= 1;
        containers.pop();
        propertyNames.pop();
        if (release) subtreeBytes = 0;
      }
      if (["trueValue", "falseValue", "nullValue"].includes(token.name)) {
        subtreeBytes += 8;
        if (subtreeBytes > VALIDATION_POLICY.maximumScalarBytes)
          throw new SbomNormalizationError(
            "normalization_malformed_input",
            "JSON subtree ceiling exceeded.",
          );
        if (depth === 1 || (depth === 2 && containers[1] === "startArray"))
          subtreeBytes = 0;
      }
      if (["startKey", "startString", "startNumber"].includes(token.name)) {
        kind =
          token.name === "startKey"
            ? "key"
            : token.name === "startString"
              ? "string"
              : "number";
        text = "";
        bytes = 0;
      } else if (token.name === "stringChunk" || token.name === "numberChunk") {
        const fragment = String(token.value);
        bytes += Buffer.byteLength(fragment);
        subtreeBytes += Buffer.byteLength(fragment);
        if (
          bytes > VALIDATION_POLICY.maximumScalarBytes ||
          subtreeBytes > VALIDATION_POLICY.maximumScalarBytes
        )
          throw new SbomNormalizationError(
            "normalization_malformed_input",
            "JSON scalar ceiling exceeded.",
          );
        text += fragment;
      } else if (["endKey", "endString", "endNumber"].includes(token.name)) {
        if (kind === "number") {
          const exponent = text.match(/[eE]([+-]?\d+)$/u)?.[1];
          const integer = text.replace(/^-/, "").split(/[.eE]/u)[0]!;
          if (
            (exponent !== undefined && Math.abs(Number(exponent)) > 308) ||
            integer.length > 309
          )
            throw new SbomNormalizationError(
              "normalization_extreme_numeric_literal",
              "JSON numeric literal exceeds deterministic bounds.",
            );
        }
        if (kind === "key") {
          const keys = propertyNames.at(-1);
          if (keys?.has(text))
            throw new SbomNormalizationError(
              "normalization_malformed_input",
              "Duplicate JSON object property.",
            );
          keys?.add(text);
          if (depth === 1) {
            rootKeyBytes += bytes;
            if (rootKeyBytes > VALIDATION_POLICY.maximumScalarBytes)
              throw new SbomNormalizationError(
                "normalization_malformed_input",
                "JSON root key ceiling exceeded.",
              );
          }
        }
        yield {
          name:
            kind === "key"
              ? "keyValue"
              : kind === "number"
                ? "numberValue"
                : "stringValue",
          value: kind === "number" ? Number(text) : text,
        };
        text = "";
        kind = null;
        if (depth === 1 && token.name !== "endKey") subtreeBytes = 0;
        if (
          depth === 2 &&
          containers[1] === "startArray" &&
          token.name !== "endKey"
        )
          subtreeBytes = 0;
      } else yield token;
    }
  } finally {
    input.off("error", forwardError);
    input.destroy();
    tokens.destroy();
  }
}
