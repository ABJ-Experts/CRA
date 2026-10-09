import { describe, expect, it } from "vitest";

import {
  calculateRiskLevel,
  createRiskRegisterRiskRequestSchema,
  riskAssessmentOutputSchema,
  riskEvidenceReferenceInputSchema,
  riskRequirementMappingInputSchema,
  updateRiskRegisterRiskRequestSchema,
} from "./risk-register.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const alternativeId = "00000000-0000-4000-8000-000000000002";
const command = {
  threat: "Unauthenticated network caller alters a product endpoint",
  affectedAssets: [{ componentId: id }],
  requirements: [
    {
      identifier: "Annex I Part I (1)",
      edition: "CRA 2024",
      sourceReference: "Regulation (EU) 2024/2847, Annex I Part I",
      rationale: "The endpoint must resist unauthorized access.",
    },
  ],
  inherentAssessment: {
    likelihood: 4,
    impact: 5,
    likelihoodRationale: "The endpoint is network reachable.",
    impactRationale: "Unauthorized alteration affects product integrity.",
  },
  mitigations: "Require authenticated, authorized requests and audit changes.",
  residualAssessment: {
    likelihood: 1,
    impact: 3,
    likelihoodRationale:
      "Authentication blocks ordinary unauthenticated access.",
    impactRationale: "Audit records bound remaining impact.",
  },
  revisionRationale: "Initial assessment.",
  ownerId: alternativeId,
  evidenceReferences: [],
  idempotencyKey: "00000000-0000-4000-8000-000000000003",
};

describe("risk-register schema boundaries", () => {
  it("pins the cra_5x5_v1 matrix instead of accepting an arbitrary level", () => {
    expect(calculateRiskLevel(1, 4)).toBe("low");
    expect(calculateRiskLevel(3, 3)).toBe("medium");
    expect(calculateRiskLevel(4, 4)).toBe("high");
    expect(calculateRiskLevel(5, 5)).toBe("critical");
    expect(() =>
      riskAssessmentOutputSchema.parse({
        ...command.inherentAssessment,
        level: "low",
      }),
    ).toThrow("Risk level must match");
  });

  it("requires both assessment rationales and bounded scale values", () => {
    expect(() =>
      createRiskRegisterRiskRequestSchema.parse({
        ...command,
        inherentAssessment: {
          ...command.inherentAssessment,
          likelihood: 6,
          likelihoodRationale: "",
        },
      }),
    ).toThrow();
  });

  it("requires a manually pinned, unresolved Annex I reference", () => {
    expect(() =>
      riskRequirementMappingInputSchema.parse({
        identifier: "Annex I Part I (1)",
        edition: "",
        sourceReference: "",
        rationale: "Mapped without a pack.",
      }),
    ).toThrow();
  });

  it("rejects duplicate affected assets and requirement identifiers", () => {
    expect(() =>
      createRiskRegisterRiskRequestSchema.parse({
        ...command,
        affectedAssets: [{ componentId: id }, { componentId: id }],
      }),
    ).toThrow("Do not repeat componentId");
    expect(() =>
      createRiskRegisterRiskRequestSchema.parse({
        ...command,
        requirements: [command.requirements[0], command.requirements[0]],
      }),
    ).toThrow("Do not repeat identifier");
  });

  it("preserves the evidence version boundary", () => {
    expect(() =>
      riskEvidenceReferenceInputSchema.parse({
        title: "Test record",
        recordId: id,
        observedRevision: null,
        locator: null,
        rationale: "Shows the control was exercised.",
      }),
    ).toThrow("exact observed revision");
    expect(() =>
      riskEvidenceReferenceInputSchema.parse({
        title: "Manual test report",
        recordId: null,
        observedRevision: "rev-1",
        locator: null,
        rationale: "Bibliographic evidence only until M7-03.",
      }),
    ).toThrow("manual evidence cannot provide one");
  });

  it("requires an optimistic version for full risk revisions", () => {
    expect(() => updateRiskRegisterRiskRequestSchema.parse(command)).toThrow();
    expect(
      updateRiskRegisterRiskRequestSchema.parse({
        ...command,
        expectedVersion: 1,
      }).expectedVersion,
    ).toBe(1);
  });
});
