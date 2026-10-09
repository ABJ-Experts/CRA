import { supplierDocumentFieldKeySchema } from "@repo/contracts/supplier-evidence/schemas";

import type { SupplierDocumentEvaluationCase } from "./supplier-document-evaluation.fixtures";

export type EvaluationCandidate = {
  fieldKey: string;
  candidateGroup: string;
  originalValue: string;
  confidence: number;
  sourceSpan: {
    page: number;
    startOffset: number;
    endOffset: number;
    quote: string;
  };
};

export type EvaluationOutput = {
  caseId: string;
  candidates: readonly EvaluationCandidate[];
};

export type EvaluationIdentity = { model: string; promptVersion: string };

export type SupplierDocumentEvaluationResult = EvaluationIdentity & {
  totals: {
    expected: number;
    proposed: number;
    correct: number;
    grounded: number;
  };
  fieldPrecision: number;
  fieldRecall: number;
  sourceGrounding: number;
  ambiguityPreserved: boolean;
  byCase: {
    caseId: string;
    expected: number;
    proposed: number;
    correct: number;
    grounded: number;
    candidateGroupsPreserved: boolean;
  }[];
  releaseGate: { enabled: false; reason: string };
};

function grounded(
  fixture: SupplierDocumentEvaluationCase,
  candidate: EvaluationCandidate,
): boolean {
  const span = candidate.sourceSpan;
  const page = fixture.pages.find((entry) => entry.page === span.page);
  return Boolean(
    page &&
    Number.isSafeInteger(span.startOffset) &&
    Number.isSafeInteger(span.endOffset) &&
    span.startOffset >= 0 &&
    span.endOffset > span.startOffset &&
    Array.from(page.text).slice(span.startOffset, span.endOffset).join("") ===
      span.quote,
  );
}

function matches(
  expected: SupplierDocumentEvaluationCase["expected"][number],
  candidate: EvaluationCandidate,
): boolean {
  return (
    supplierDocumentFieldKeySchema.safeParse(candidate.fieldKey).success &&
    expected.fieldKey === candidate.fieldKey &&
    expected.value.normalize("NFC") ===
      candidate.originalValue.trim().normalize("NFC") &&
    expected.span.page === candidate.sourceSpan.page &&
    expected.span.startOffset === candidate.sourceSpan.startOffset &&
    expected.span.endOffset === candidate.sourceSpan.endOffset &&
    expected.span.quote === candidate.sourceSpan.quote
  );
}

/** No production bulk action is unlocked without approved, independently measured thresholds. */
export function releaseGateForSupplierDocumentExtraction(
  measurements: EvaluationIdentity & {
    fieldPrecision: number;
    fieldRecall: number;
    sourceGrounding: number;
  },
): { enabled: false; reason: string } {
  if (!measurements.model || !measurements.promptVersion) {
    throw new Error("Evaluation identity must name a model and prompt version");
  }
  return {
    enabled: false,
    reason: "confidence threshold and model evaluation not approved",
  };
}

export function evaluateSupplierDocumentExtraction(
  fixtures: readonly SupplierDocumentEvaluationCase[],
  outputs: readonly EvaluationOutput[],
  identity: EvaluationIdentity,
): SupplierDocumentEvaluationResult {
  const fixtureIds = fixtures.map(({ id }) => id);
  const outputIds = outputs.map(({ caseId }) => caseId);
  if (
    new Set(fixtureIds).size !== fixtures.length ||
    new Set(outputIds).size !== outputs.length ||
    fixtureIds.length !== outputIds.length ||
    fixtureIds.some((id) => !outputIds.includes(id))
  ) {
    throw new Error("Evaluation requires exactly one output per case");
  }

  const byCase = fixtures.map((fixture) => {
    const output = outputs.find(({ caseId }) => caseId === fixture.id);
    if (!output)
      throw new Error("Evaluation requires exactly one output per case");
    let matchedExpectedIndexes: number[] = [];
    let groupPairs: { expected: string; proposed: string }[] = [];
    let correct = 0;
    let groundedCount = 0;
    for (const candidate of output.candidates) {
      if (!grounded(fixture, candidate)) continue;
      groundedCount += 1;
      const matchedIndex = fixture.expected.findIndex(
        (expected, index) =>
          !matchedExpectedIndexes.includes(index) &&
          matches(expected, candidate),
      );
      if (matchedIndex < 0) continue;
      correct += 1;
      matchedExpectedIndexes = [...matchedExpectedIndexes, matchedIndex];
      groupPairs = [
        ...groupPairs,
        {
          expected: fixture.expected[matchedIndex]!.candidateGroup,
          proposed: candidate.candidateGroup,
        },
      ];
    }
    const candidateGroupsPreserved = groupPairs.every((pair) =>
      groupPairs.every(
        (other) =>
          (pair.expected !== other.expected ||
            pair.proposed === other.proposed) &&
          (pair.proposed !== other.proposed ||
            pair.expected === other.expected),
      ),
    );
    return {
      caseId: fixture.id,
      expected: fixture.expected.length,
      proposed: output.candidates.length,
      correct,
      grounded: groundedCount,
      candidateGroupsPreserved,
    };
  });
  const totals = byCase.reduce(
    (acc, item) => ({
      expected: acc.expected + item.expected,
      proposed: acc.proposed + item.proposed,
      correct: acc.correct + item.correct,
      grounded: acc.grounded + item.grounded,
    }),
    { expected: 0, proposed: 0, correct: 0, grounded: 0 },
  );
  const fieldPrecision =
    totals.proposed === 0 ? 1 : totals.correct / totals.proposed;
  const fieldRecall =
    totals.expected === 0 ? 1 : totals.correct / totals.expected;
  const sourceGrounding =
    totals.proposed === 0 ? 1 : totals.grounded / totals.proposed;
  return {
    ...identity,
    totals,
    fieldPrecision,
    fieldRecall,
    sourceGrounding,
    ambiguityPreserved: byCase.every(({ candidateGroupsPreserved }) =>
      Boolean(candidateGroupsPreserved),
    ),
    byCase,
    releaseGate: releaseGateForSupplierDocumentExtraction({
      ...identity,
      fieldPrecision,
      fieldRecall,
      sourceGrounding,
    }),
  };
}
