import { ConfigService } from "@nestjs/config";

import { AiGateway, AiGatewayError } from "../ai-gateway";
import { SUPPLIER_FIELDS_PROMPT_VERSION } from "../supplier-fields.prompt";
import { supplierDocumentEvaluationCases } from "./supplier-document-evaluation.fixtures";
import {
  evaluateSupplierDocumentExtraction,
  type EvaluationOutput,
  type SupplierDocumentEvaluationResult,
} from "./supplier-document-evaluation";

const SYNTHETIC_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const SYNTHETIC_VERSION_ID = "00000000-0000-4000-8000-000000000002";

export type LocalEvaluationOutcome =
  | { status: "completed"; result: SupplierDocumentEvaluationResult }
  | {
      status: "incomplete";
      model: string;
      promptVersion: string;
      failures: { caseId: string; code: string }[];
      releaseGate: { enabled: false; reason: string };
    };

/** Executes only synthetic cases; one provider failure invalidates the whole measurement. */
export async function runLocalSupplierDocumentEvaluation(
  gateway: Pick<AiGateway, "extractSupplierFields">,
  model: string,
): Promise<LocalEvaluationOutcome> {
  const outputs: EvaluationOutput[] = [];
  const failures: { caseId: string; code: string }[] = [];
  for (const fixture of supplierDocumentEvaluationCases) {
    try {
      const result = await gateway.extractSupplierFields({
        organizationId: SYNTHETIC_ORGANIZATION_ID,
        versionId: SYNTHETIC_VERSION_ID,
        sourceSha256: "0".repeat(64),
        pages: fixture.pages,
        policy: {
          enabled: true,
          mode: "local-only",
          remainingTokens: 12_000,
        },
      });
      outputs.push({ caseId: fixture.id, candidates: result.candidates });
    } catch (error) {
      failures.push({
        caseId: fixture.id,
        code: error instanceof AiGatewayError ? error.code : "unknown_failure",
      });
    }
  }
  if (failures.length > 0) {
    return {
      status: "incomplete",
      model,
      promptVersion: SUPPLIER_FIELDS_PROMPT_VERSION,
      failures,
      releaseGate: {
        enabled: false,
        reason: "evaluation incomplete",
      },
    };
  }
  return {
    status: "completed",
    result: evaluateSupplierDocumentExtraction(
      supplierDocumentEvaluationCases,
      outputs,
      { model, promptVersion: SUPPLIER_FIELDS_PROMPT_VERSION },
    ),
  };
}

export async function runSupplierDocumentEvaluationCli(
  gateway: Pick<AiGateway, "extractSupplierFields">,
  model: string,
  write: (output: string) => void,
): Promise<number> {
  const result = await runLocalSupplierDocumentEvaluation(gateway, model);
  write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === "completed" ? 0 : 1;
}

/* istanbul ignore next -- process entrypoint; injected CLI behavior is tested above. */
if (require.main === module) {
  const config = new ConfigService(process.env);
  const model = config.get<string>("AI_OLLAMA_MODEL") ?? "unconfigured";
  void runSupplierDocumentEvaluationCli(
    new AiGateway(config),
    model,
    (output) => process.stdout.write(output),
  ).then((code) => {
    process.exitCode = code;
  });
}
