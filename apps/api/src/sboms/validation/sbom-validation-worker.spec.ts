import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  sbomValidationWorkerExecArgv,
  sbomValidationWorkerResourceLimits,
  validateSbomInWorker,
} from "./sbom-validation-worker";

describe("validateSbomInWorker", () => {
  it("returns a validation report from an isolated worker", async () => {
    const result = await validateSbomInWorker({
      bytes: readFileSync(join(__dirname, "fixtures", "cyclonedx-1.6.json")),
      fileName: "cyclonedx-1.6.json",
      mediaType: "application/vnd.cyclonedx+json",
    });

    expect(result).toMatchObject({
      outcome: "validated",
      report: {
        status: "valid",
        detected: {
          format: "cyclonedx",
          serialization: "json",
          specificationVersion: "1.6",
        },
      },
    });
  });

  it("makes worker timeouts retryable infrastructure failures", async () => {
    const result = await validateSbomInWorker(
      {
        bytes: readFileSync(join(__dirname, "fixtures", "cyclonedx-1.6.xml")),
        fileName: "cyclonedx-1.6.xml",
        mediaType: "application/vnd.cyclonedx+xml",
      },
      { timeoutMs: 1 },
    );

    expect(result).toEqual({
      outcome: "unavailable",
      code: "validator_timeout",
      retryable: true,
      message: "SBOM validation worker timed out.",
    });
  });

  it("uses ts-node only for TypeScript worker entrypoints", () => {
    expect(
      sbomValidationWorkerExecArgv("/tmp/sbom-validation-worker.ts"),
    ).toEqual([
      "-r",
      "ts-node/register/transpile-only",
      "-r",
      "tsconfig-paths/register",
    ]);
    expect(
      sbomValidationWorkerExecArgv("/tmp/sbom-validation-worker.js"),
    ).toEqual([]);
  });

  it("bounds the isolated validator worker heap for opaque provider failures", () => {
    expect(sbomValidationWorkerResourceLimits()).toEqual({
      maxOldGenerationSizeMb: 512,
    });
  });
});
