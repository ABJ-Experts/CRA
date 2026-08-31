import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

import type { SbomValidationReport } from "@repo/contracts/sboms";

import {
  type ValidateSbomInput,
  SbomValidationInfrastructureError,
  validateSbom,
} from "./sbom-validator";
import { VALIDATION_POLICY } from "./sbom-validation-policy";

export type SbomValidationWorkerResult =
  | Readonly<{ outcome: "validated"; report: SbomValidationReport }>
  | Readonly<{
      outcome: "unavailable";
      code: "validator_timeout" | "validator_unavailable" | "validator_crashed";
      retryable: true;
      message: string;
    }>;

export type ValidateSbomWorkerOptions = Readonly<{ timeoutMs?: number }>;

const SBOM_VALIDATION_WORKER_MAX_OLD_SPACE_MB = 512;

/**
 * The upstream XML provider has no bounded-error callback and can allocate an
 * opaque error collection internally. Keep that allocation in the isolated
 * validation worker under a finite V8 heap limit; exhaustion is surfaced by
 * the existing retryable crash path rather than affecting the API process.
 */
export function sbomValidationWorkerResourceLimits(): Readonly<{
  maxOldGenerationSizeMb: number;
}> {
  return Object.freeze({
    maxOldGenerationSizeMb: SBOM_VALIDATION_WORKER_MAX_OLD_SPACE_MB,
  });
}

export async function validateSbomInWorker(
  input: ValidateSbomInput,
  options: ValidateSbomWorkerOptions = {},
): Promise<SbomValidationWorkerResult> {
  const timeoutMs = options.timeoutMs ?? VALIDATION_POLICY.workerTimeoutMs;
  return await new Promise<SbomValidationWorkerResult>((resolve) => {
    const worker = new Worker(__filename, {
      workerData: {
        ...input,
        bytes: Buffer.from(input.bytes),
      },
      execArgv: sbomValidationWorkerExecArgv(__filename),
      resourceLimits: sbomValidationWorkerResourceLimits(),
    });
    let settled = false;
    const settle = (result: SbomValidationWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      settle({
        outcome: "unavailable",
        code: "validator_timeout",
        retryable: true,
        message: "SBOM validation worker timed out.",
      });
    }, timeoutMs);
    worker.once("message", (message: SbomValidationWorkerResult) => {
      settle(message);
    });
    /* istanbul ignore next -- process-level crash handling is exercised by the worker result contract, not by forcing Jest worker crashes. */
    worker.once("error", () => {
      settle({
        outcome: "unavailable",
        code: "validator_crashed",
        retryable: true,
        message: "SBOM validation worker crashed.",
      });
    });
    /* istanbul ignore next -- non-zero child exit is an OS-level crash path; timeout and success paths cover normal worker lifecycle. */
    worker.once("exit", (code) => {
      if (code !== 0) {
        settle({
          outcome: "unavailable",
          code: "validator_crashed",
          retryable: true,
          message: "SBOM validation worker crashed.",
        });
      }
    });
  });
}

export function sbomValidationWorkerExecArgv(filename: string): string[] {
  return filename.endsWith(".ts")
    ? ["-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register"]
    : [];
}

/* istanbul ignore next -- this runs inside the child worker process, while coverage is collected in the parent Jest process. */
async function runWorker(): Promise<void> {
  if (parentPort === null) return;
  try {
    const report = await validateSbom(workerData as ValidateSbomInput);
    parentPort.postMessage({ outcome: "validated", report });
  } catch (error) {
    if (error instanceof SbomValidationInfrastructureError) {
      parentPort.postMessage({
        outcome: "unavailable",
        code: error.code,
        retryable: true,
        message: "SBOM validation provider is unavailable.",
      });
      return;
    }
    parentPort.postMessage({
      outcome: "unavailable",
      code: "validator_crashed",
      retryable: true,
      message: "SBOM validation worker crashed.",
    });
  }
}

/* istanbul ignore next -- child worker bootstrap is validated through validateSbomInWorker. */
if (!isMainThread) {
  void runWorker();
}
