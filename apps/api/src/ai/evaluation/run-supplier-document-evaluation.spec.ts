import { AiGatewayError } from "../ai-gateway";
import { supplierDocumentEvaluationCases } from "./supplier-document-evaluation.fixtures";
import {
  runLocalSupplierDocumentEvaluation,
  runSupplierDocumentEvaluationCli,
} from "./run-supplier-document-evaluation";

describe("local supplier document evaluation runner", () => {
  it("runs every synthetic case with local-only policy and reports real gateway output", async () => {
    const extractSupplierFields = jest
      .fn()
      .mockResolvedValue({ candidates: [] });
    const outcome = await runLocalSupplierDocumentEvaluation(
      { extractSupplierFields },
      "test-model",
    );
    expect(extractSupplierFields).toHaveBeenCalledTimes(
      supplierDocumentEvaluationCases.length,
    );
    expect(extractSupplierFields).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        policy: { enabled: true, mode: "local-only", remainingTokens: 12_000 },
      }),
    );
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.result.model).toBe("test-model");
    expect(outcome.result.totals.proposed).toBe(0);
    expect(outcome.result.fieldRecall).toBe(0);
    expect(outcome.result.releaseGate.enabled).toBe(false);
  });

  it("reports provider failure without fabricating partial metrics", async () => {
    const extractSupplierFields = jest
      .fn()
      .mockRejectedValueOnce(new AiGatewayError("unavailable"))
      .mockResolvedValue({ candidates: [] });
    const outcome = await runLocalSupplierDocumentEvaluation(
      { extractSupplierFields },
      "test-model",
    );
    expect(outcome).toMatchObject({
      status: "incomplete",
      failures: [{ caseId: "noisy-scan", code: "unavailable" }],
      releaseGate: { enabled: false },
    });
    expect(outcome).not.toHaveProperty("result");
  });

  it("emits complete and incomplete JSON with distinct exit codes", async () => {
    const write = jest.fn();
    const successCode = await runSupplierDocumentEvaluationCli(
      {
        extractSupplierFields: jest.fn().mockResolvedValue({ candidates: [] }),
      },
      "test-model",
      write,
    );
    expect(successCode).toBe(0);
    expect(write).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('"status": "completed"'),
    );
    const failureCode = await runSupplierDocumentEvaluationCli(
      {
        extractSupplierFields: jest
          .fn()
          .mockRejectedValue(new AiGatewayError("unavailable")),
      },
      "test-model",
      write,
    );
    expect(failureCode).toBe(1);
    expect(write).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"status": "incomplete"'),
    );
  });
});
