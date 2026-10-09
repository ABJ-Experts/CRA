import { describe, expect, it } from "vitest";

import {
  approveReportingStageDraftInputSchema,
  createReportingFamilyTemplateInputSchema,
  reauthenticateReportingStageApprovalInputSchema,
  reauthenticateReportingStageApprovalResponseSchema,
  reportingFamilyTemplateVersionSchema,
  reportingStageDraftSchema,
  reportingStageFieldProvenanceSchema,
  saveReportingStageDraftInputSchema,
} from "./reporting-stage-drafts.schema";

const id = "11111111-1111-4111-8111-111111111111";
const actor = { userId: id, displayName: "Owner" };
const timestamp = "2026-09-10T09:20:00Z";
const provenance = { origin: "human" as const, actor, recordedAt: timestamp };
const definitions = [
  {
    key: "summary",
    label: "Summary",
    description: null,
    type: "long_text" as const,
    required: true,
    requiredWhen: null,
    templateEligible: true,
  },
  {
    key: "customer_impact",
    label: "Customer impact",
    description: null,
    type: "boolean" as const,
    required: false,
    requiredWhen: { fieldKey: "summary", equals: "incident" },
    templateEligible: true,
  },
  {
    key: "member_states",
    label: "Member States",
    description: null,
    type: "member_states" as const,
    required: true,
    requiredWhen: null,
    templateEligible: false,
  },
];
const fields = [
  {
    value: { key: "summary", type: "long_text" as const, value: "incident" },
    provenance,
    updatedAt: timestamp,
  },
];

describe("reporting stage draft contracts", () => {
  it("models a strict editable draft with declared field provenance and release Member States", () => {
    expect(
      reportingStageDraftSchema.parse({
        id,
        organizationId: id,
        obligationId: id,
        stageId: id,
        releaseId: id,
        stage: "notification",
        revision: 1,
        contentHash: "a".repeat(64),
        status: "editable",
        completeness: "incomplete",
        fieldDefinitions: definitions,
        fields,
        memberStates: [{ countryCode: "DE", provenance }],
        prepopulatedFromSubmissionId: null,
        requiresTemplateReview: false,
        lock: null,
        createdBy: actor,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toHaveProperty("memberStates.0.countryCode", "DE");
  });

  it("rejects unknown fields, duplicate field values, mismatched definitions, and lock-state contradictions", () => {
    const base = {
      id,
      organizationId: id,
      obligationId: id,
      stageId: id,
      releaseId: id,
      stage: "notification",
      revision: 1,
      contentHash: "a".repeat(64),
      status: "editable",
      completeness: "incomplete",
      fieldDefinitions: definitions,
      fields,
      memberStates: [{ countryCode: "DE", provenance }],
      prepopulatedFromSubmissionId: null,
      requiresTemplateReview: false,
      lock: null,
      createdBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(
      reportingStageDraftSchema.safeParse({ ...base, unexpected: true })
        .success,
    ).toBe(false);
    expect(
      reportingStageDraftSchema.safeParse({
        ...base,
        fields: [...fields, fields[0]],
      }).success,
    ).toBe(false);
    expect(
      reportingStageDraftSchema.safeParse({
        ...base,
        status: "locked",
        lock: null,
      }).success,
    ).toBe(false);
  });

  it("requires named acceptance for AI provenance and cannot silently accept an AI suggestion", () => {
    expect(
      reportingStageFieldProvenanceSchema.safeParse({
        origin: "ai_accepted",
        suggestionReference: "suggestion-1",
        acceptedAt: timestamp,
      }).success,
    ).toBe(false);
    expect(
      reportingStageFieldProvenanceSchema.parse({
        origin: "ai_accepted",
        suggestionReference: "suggestion-1",
        acceptedBy: actor,
        acceptedAt: timestamp,
      }),
    ).toHaveProperty("acceptedBy.userId", id);
  });

  it("excludes Member States and event timestamps from reusable family-template content", () => {
    expect(
      createReportingFamilyTemplateInputSchema.safeParse({
        obligationType: "severe_incident",
        stage: "notification",
        name: "Incident baseline",
        fields: [
          {
            value: {
              key: "member_states",
              type: "member_states",
              value: ["DE"],
            },
            provenance,
            updatedAt: timestamp,
          },
        ],
        idempotencyKey: id,
      }).success,
    ).toBe(false);
    expect(
      reportingFamilyTemplateVersionSchema.safeParse({
        id,
        version: 1,
        fields: [
          {
            value: {
              key: "member_states",
              type: "member_states",
              value: ["DE"],
            },
            provenance,
            updatedAt: timestamp,
          },
        ],
        createdBy: actor,
        createdAt: timestamp,
      }).success,
    ).toBe(false);
    expect(
      createReportingFamilyTemplateInputSchema.safeParse({
        obligationType: "severe_incident",
        stage: "notification",
        name: "Duplicate",
        fields: [fields[0], fields[0]],
        idempotencyKey: id,
      }).success,
    ).toBe(false);
  });

  it("requires optimistic revision, lock, complete replacement payload, and idempotency for saves", () => {
    expect(
      saveReportingStageDraftInputSchema.safeParse({
        expectedRevision: 1,
        lockToken: id,
        fields,
        memberStates: [{ countryCode: "DE", provenance }],
      }).success,
    ).toBe(false);
    expect(
      saveReportingStageDraftInputSchema.parse({
        expectedRevision: 1,
        lockToken: id,
        fields,
        memberStates: [{ countryCode: "DE", provenance }],
        idempotencyKey: id,
      }),
    ).toHaveProperty("expectedRevision", 1);
  });

  it("binds fresh approval reauthentication and one-use proof consumption to an exact draft revision hash", () => {
    const hash = "a".repeat(64);
    expect(
      reauthenticateReportingStageApprovalInputSchema.parse({
        draftRevision: 2,
        draftHash: hash,
        password: "fresh-password",
        mfaCode: "123456",
        idempotencyKey: id,
      }),
    ).toHaveProperty("draftHash", hash);
    expect(
      reauthenticateReportingStageApprovalInputSchema.safeParse({
        draftRevision: 2,
        draftHash: "A".repeat(64),
        password: "fresh-password",
        idempotencyKey: id,
      }).success,
    ).toBe(false);
    expect(
      reauthenticateReportingStageApprovalResponseSchema.safeParse({
        reauthenticationProofId: id,
        expiresAt: timestamp,
        password: "must-never-be-returned",
      }).success,
    ).toBe(false);
    expect(
      approveReportingStageDraftInputSchema.parse({
        draftRevision: 2,
        draftHash: hash,
        reauthenticationProofId: id,
        segregationOfDutiesOverrideReason:
          "Only approved responder available during incident response.",
        idempotencyKey: id,
      }),
    ).toHaveProperty("reauthenticationProofId", id);
    expect(
      approveReportingStageDraftInputSchema.safeParse({
        draftRevision: 2,
        draftHash: hash,
        reauthenticationProofId: id,
        submissionReference: "CRA-PORTAL-2026-0001",
        idempotencyKey: id,
      }).success,
    ).toBe(false);
  });
});
