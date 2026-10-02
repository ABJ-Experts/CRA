import {
  evaluationCitation,
  supplierDocumentEvaluationCases,
} from "./supplier-document-evaluation.fixtures";
import {
  evaluateSupplierDocumentExtraction,
  releaseGateForSupplierDocumentExtraction,
} from "./supplier-document-evaluation";

describe("supplier document extraction evaluation", () => {
  it("covers OCR noise, ambiguity, multilingual text, absent evidence and hostile instructions", () => {
    expect(supplierDocumentEvaluationCases.map(({ id }) => id)).toEqual([
      "noisy-scan",
      "conflicting-certificates-and-dates",
      "multilingual-layout",
      "no-evidence",
      "hostile-instructions",
    ]);
    expect(
      supplierDocumentEvaluationCases.every(({ pages }) => pages.length > 0),
    ).toBe(true);
  });

  it("requires unambiguous exact source text for fixture citations", () => {
    expect(() => evaluationCitation(1, "abc", "missing")).toThrow(
      "exactly once",
    );
    expect(() => evaluationCitation(1, "abc abc", "abc")).toThrow(
      "exactly once",
    );
    expect(evaluationCitation(1, "供应商 ISO", "ISO")).toEqual({
      page: 1,
      startOffset: 4,
      endOffset: 7,
      quote: "ISO",
    });
  });

  it("scores exact supported fields and citations without giving credit to guesses", () => {
    const fixtures = supplierDocumentEvaluationCases;
    const outputs = fixtures.map(({ id, expected }) => ({
      caseId: id,
      candidates: expected.map(({ candidateGroup, fieldKey, value, span }) => ({
        candidateGroup,
        fieldKey,
        originalValue: value,
        confidence: 0.9,
        sourceSpan: span,
      })),
    }));
    const result = evaluateSupplierDocumentExtraction(fixtures, outputs, {
      model: "fixture-oracle",
      promptVersion: "test-only",
    });
    expect(result.totals).toEqual({
      expected: fixtures.reduce((sum, item) => sum + item.expected.length, 0),
      proposed: fixtures.reduce((sum, item) => sum + item.expected.length, 0),
      correct: fixtures.reduce((sum, item) => sum + item.expected.length, 0),
      grounded: fixtures.reduce((sum, item) => sum + item.expected.length, 0),
    });
    expect(result.fieldPrecision).toBe(1);
    expect(result.fieldRecall).toBe(1);
    expect(result.sourceGrounding).toBe(1);
    expect(result.releaseGate.enabled).toBe(false);
  });

  it("penalizes wrong citations, unsupported fields, missed alternatives and false positives", () => {
    const conflicting = supplierDocumentEvaluationCases[1]!;
    const expected = conflicting.expected[0]!;
    const result = evaluateSupplierDocumentExtraction(
      [conflicting],
      [
        {
          caseId: conflicting.id,
          candidates: [
            {
              candidateGroup: "first",
              fieldKey: expected.fieldKey,
              originalValue: expected.value,
              confidence: 0.99,
              sourceSpan: { ...expected.span, quote: "fabricated" },
            },
            {
              candidateGroup: "injected",
              fieldKey: "admin_override",
              originalValue: "true",
              confidence: 1,
              sourceSpan: expected.span,
            },
          ],
        },
      ],
      { model: "test", promptVersion: "test" },
    );
    expect(result.totals.correct).toBe(0);
    expect(result.totals.grounded).toBe(1);
    expect(result.fieldPrecision).toBe(0);
    expect(result.fieldRecall).toBe(0);
    expect(result.sourceGrounding).toBe(0.5);
  });

  it("fails closed when a case is absent or duplicated", () => {
    expect(() =>
      evaluateSupplierDocumentExtraction(supplierDocumentEvaluationCases, [], {
        model: "test",
        promptVersion: "test",
      }),
    ).toThrow("one output per case");
    expect(() =>
      evaluateSupplierDocumentExtraction(
        [supplierDocumentEvaluationCases[0]!],
        [
          { caseId: "noisy-scan", candidates: [] },
          { caseId: "noisy-scan", candidates: [] },
        ],
        { model: "test", promptVersion: "test" },
      ),
    ).toThrow("one output per case");
  });

  it("flags a collapsed candidate group even if every quoted value is correct", () => {
    const fixture = supplierDocumentEvaluationCases[1]!;
    const result = evaluateSupplierDocumentExtraction(
      [fixture],
      [
        {
          caseId: fixture.id,
          candidates: fixture.expected.map(({ fieldKey, value, span }) => ({
            fieldKey,
            candidateGroup: "all-certificates",
            originalValue: value,
            confidence: 0.99,
            sourceSpan: span,
          })),
        },
      ],
      { model: "test", promptVersion: "test" },
    );
    expect(result.totals.correct).toBe(fixture.expected.length);
    expect(result.ambiguityPreserved).toBe(false);
    expect(result.byCase[0]!.candidateGroupsPreserved).toBe(false);
  });

  it("does not unlock bulk confirmation from a synthetic oracle or provisional threshold", () => {
    expect(
      releaseGateForSupplierDocumentExtraction({
        fieldPrecision: 1,
        fieldRecall: 1,
        sourceGrounding: 1,
        model: "fixture-oracle",
        promptVersion: "test-only",
      }),
    ).toEqual({
      enabled: false,
      reason: "confidence threshold and model evaluation not approved",
    });
  });
});
